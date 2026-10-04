/*jshint browser:true*/
/*
 * Copyright (c) Codiad & Andr3as, distributed
 * as-is and without warranty under the MIT License.
 * See http://opensource.org/licenses/MIT for more information.
 * This information must remain intact.
 *
 * Originally based on the Atheos Minimap plugin, Copyright (c) Liam Siira,
 * distributed as-is and without warranty under the MIT License. See LICENSE.md.
 * Token highlighting by Lumin (lolight), see lumin.js.
 */

(function(global, $) {

	var codiad = global.codiad;

	/* Path to this plugin, derived from the script tag that loaded us. */
	var scripts = document.getElementsByTagName('script');
	var src = '';
	for (var i = scripts.length - 1; i >= 0; i--) {
		if (scripts[i].src && /\/plugins\//.test(scripts[i].src)) {
			src = scripts[i].src;
			break;
		}
	}
	if (!src) {
		/* Fall back on the last script tag, which is this file. */
		for (var j = scripts.length - 1; j >= 0; j--) {
			if (scripts[j].src) {
				src = scripts[j].src;
				break;
			}
		}
	}
	var curpath = src ? src.split('?')[0].split('/').slice(0, -1).join('/') + '/' : '';

	//////////////////////////////////////////////////////////////////
	// Rate limit a function, trailing edge
	//////////////////////////////////////////////////////////////////

	function throttle(fn, wait) {
		var last = 0;
		var timer = null;
		return function() {
			var self = this;
			var args = arguments;
			var remaining = wait - (new Date().getTime() - last);
			if (remaining <= 0) {
				if (timer) {
					clearTimeout(timer);
					timer = null;
				}
				last = new Date().getTime();
				fn.apply(self, args);
			} else if (!timer) {
				timer = setTimeout(function() {
					timer = null;
					last = new Date().getTime();
					fn.apply(self, args);
				}, remaining);
			}
		};
	}

	$(function() {
		codiad.MiniMap.init();
	});

	codiad.MiniMap = {

		path: curpath,
		controller: 'controller.php',

		template: '<div id="minimap"><div class="overlay"></div><pre><code></code></pre></div>',

		worker: null,

		/* Rendered minimap markup, keyed by path */
		cache: {},

		/* Path the last worker request was made for */
		pendingPath: null,

		overlay: null,
		code: null,
		pre: null,
		minimap: null,

		/* Active ace editor instance and the session bound to it */
		active: null,
		session: null,
		activePath: null,

		/* Geometry of the rendered map */
		lines: 0,
		size: 0,
		length: 0,
		height: 0,

		//////////////////////////////////////////////////////////////////
		// Maps a minimap class to the preset token holding its color.
		// Lumin emits ll-wrd for identifiers and ll-unk for anything it does
		// not recognise, both of which take the theme default color, as does
		// ll-nam. ll-spc is whitespace and stays uncolored.
		//////////////////////////////////////////////////////////////////

		tokenClasses: {
			'll-nam': 'nam',
			'll-wrd': 'nam',
			'll-unk': 'nam',
			'll-var': 'var',
			'll-con': 'con',
			'll-bol': 'bol',
			'll-num': 'num',
			'll-str': 'str',
			'll-rex': 'rex',
			'll-pct': 'pct',
			'll-brc': 'brc',
			'll-key': 'key',
			'll-com': 'com'
		},

		/* Color presets for all ACE themes, loaded from the controller.
		 * key = 'ace/theme/<name>', value = token colors. */
		presets: null,

		currentTheme: null,
		styleEl: null,

		//////////////////////////////////////////////////////////////////
		//
		// Initialize
		//
		//////////////////////////////////////////////////////////////////

		init: function() {
			var _this = this;

			/* Kept inside #editor-region, which survives editor.exterminate() */
			$('#editor-top-bar').before(this.template);

			this.minimap = $('#minimap');
			this.overlay = $('#minimap .overlay');
			this.code = $('#minimap code');
			this.pre = $('#minimap pre');

			this.worker = new Worker(this.path + 'worker.js');
			this.worker.addEventListener('message', function(e) {
				_this.getWorkerResult(e);
			});

			this.throttleChange = throttle(function() {
				_this.createMap();
			}, 500);
			this.throttleScroll = throttle(function() {
				_this.moveOverlay(false);
			}, 1);

			// Focus from the active component.
			amplify.subscribe('active.onFocus', function(path) {
				_this.onFocus(path);
			});

			// Reset the canvas when everything is closed.
			amplify.subscribe('active.onClose active.onRemoveAll', function() {
				_this.resetMap();
			});

			// Follow renames so the cache does not go stale.
			amplify.subscribe('active.onRename', function(data) {
				if (data && data.oldPath && data.newPath) {
					_this.onRename(data.oldPath, data.newPath);
				}
			});

			// Presets are cached server side, reload them on demand.
			amplify.subscribe('settings.loaded', function() {
				_this.loadPresets();
			});

			/* The theme is only ever changed from the settings dialog in
			 * this window, and through localStorage from another one. */
			amplify.subscribe('settings.dialog.save', function() {
				_this.updateThemeStyles(true);
			});
			amplify.subscribe('settings.changed', function(data) {
				if (data && data.key === 'codiad.editor.theme') {
					_this.updateThemeStyles(true);
				}
			});

			/* Safety net: ace swaps the theme css class on the container, so
			 * observe that too, which also covers split panes. */
			this.observeTheme();

			$(window).resize(function() {
				if (_this.active) {
					_this.moveOverlay(true);
				}
			});

			this.bindDrag();

			this.updateThemeStyles(true);
			this.loadPresets();
		},

		//////////////////////////////////////////////////////////////////
		//
		// Focus on an opened file
		//
		//////////////////////////////////////////////////////////////////

		onFocus: function(path) {
			if (path === undefined || path === null) {
				path = codiad.active.getPath();
			}
			if (!path) return;

			this.active = codiad.editor.getActive();
			if (!this.active) return;

			/* The editor was re-created, make sure our markup is still there. */
			if (this.code.length === 0) {
				this.recreate();
				if (this.code.length === 0) return;
			}

			this.updateThemeStyles(false);
			this.bindSession(this.active.getSession());

			if (path !== this.activePath) {
				this.activePath = path;
				this.createMap(path);
			} else {
				this.moveOverlay(true);
			}
		},

		//////////////////////////////////////////////////////////////////
		//
		// Listen to the session currently shown in the editor
		//
		//////////////////////////////////////////////////////////////////

		bindSession: function(session) {
			if (!session || this.session === session) return;

			var _this = this;

			this.unbindSession();

			this.session = session;
			this.onChange = function() {
				_this.throttleChange();
			};
			this.onScroll = function() {
				_this.throttleScroll();
			};

			session.on('change', this.onChange);
			session.on('changeScrollTop', this.onScroll);
		},

		//////////////////////////////////////////////////////////////////
		//
		// Stop listening to the session we were bound to
		//
		//////////////////////////////////////////////////////////////////

		unbindSession: function() {
			if (this.session) {
				if (this.onChange) this.session.off('change', this.onChange);
				if (this.onScroll) this.session.off('changeScrollTop', this.onScroll);
			}
			this.session = null;
			this.onChange = null;
			this.onScroll = null;
		},

		//////////////////////////////////////////////////////////////////
		//
		// Build the map for a path, from cache when possible
		//
		//////////////////////////////////////////////////////////////////

		createMap: function(path) {
			if (path === undefined || path === null) {
				path = this.activePath;
			}
			if (!path || !this.active || !this.worker) return;

			if (this.cache[path] !== undefined) {
				this.render(this.cache[path]);
				return;
			}

			this.pendingPath = path;
			this.worker.postMessage({
				code: this.active.getSession().getValue()
			});
		},

		//////////////////////////////////////////////////////////////////
		//
		// Handle the highlighted markup coming back from the worker
		//
		//////////////////////////////////////////////////////////////////

		getWorkerResult: function(e) {
			var path = this.pendingPath;
			if (!path) return;

			this.cache[path] = e.data.code;

			/* Only paint if the user is still on the file we rendered. */
			if (path === this.activePath) {
				this.render(e.data.code);
			}
		},

		//////////////////////////////////////////////////////////////////
		//
		// Paint the map
		//
		//////////////////////////////////////////////////////////////////

		render: function(html) {
			this.code.html(html);

			this.height = this.pre.height();
			this.length = this.active.getSession().getLength();

			this.moveOverlay(true);
		},

		//////////////////////////////////////////////////////////////////
		//
		// Move and size the overlay over the visible rows
		//
		// Parameters:
		//   build - {Boolean} recompute the height of the overlay
		//
		//////////////////////////////////////////////////////////////////

		moveOverlay: function(build) {
			if (!this.active || this.length === 0) return;

			var first = this.active.renderer.getFirstFullyVisibleRow();
			if (build) {
				var last = this.active.renderer.getLastFullyVisibleRow() + 1;
				this.lines = last - first;
			}
			this.height = this.pre.height();
			this.size = this.height / this.length * this.lines;
			this.overlay.css('height', this.size + 'px');
			var offset = this.height / this.length * first;
			this.overlay.css('margin-top', offset + 'px');

			var container = this.minimap.length ? this.minimap[0] : null;
			if (!container) return;

			/* Keep the visible slice of the map under the visible rows. */
			var containerHeight = container.clientHeight;
			if (this.height > containerHeight) {
				var maxFirst = this.length - this.lines;
				var ratio = maxFirst > 0 ? (first / maxFirst) : 0;
				ratio = Math.min(Math.max(0, ratio), 1);
				container.scrollTop = ratio * (this.height - containerHeight);
			} else {
				container.scrollTop = 0;
			}
		},

		//////////////////////////////////////////////////////////////////
		//
		// Clear the map
		//
		//////////////////////////////////////////////////////////////////

		resetMap: function() {
			if (this.code) {
				this.code.empty();
				this.overlay.css('height', 0);
			}
			if (this.minimap && this.minimap.length) {
				this.minimap[0].scrollTop = 0;
			}

			this.unbindSession();

			this.active = null;
			this.activePath = null;
			this.pendingPath = null;
			this.lines = 0;
			this.length = 0;
			this.height = 0;
		},

		//////////////////////////////////////////////////////////////////
		//
		// Move the cache entry of a renamed file
		//
		//////////////////////////////////////////////////////////////////

		onRename: function(oldPath, newPath) {
			if (this.cache[oldPath] !== undefined) {
				this.cache[newPath] = this.cache[oldPath];
				delete this.cache[oldPath];
			}
			if (this.activePath === oldPath) {
				this.activePath = newPath;
			}
		},

		//////////////////////////////////////////////////////////////////
		//
		// Drag the map to scroll the editor
		//
		//////////////////////////////////////////////////////////////////

		bindDrag: function() {
			var _this = this;
			var dragging = false;
			var containerTop = 0;

			var handleDrag = function(e) {
				if (!_this.active || _this.length === 0 || _this.height === 0) return;
				var container = _this.minimap.length ? _this.minimap[0] : null;
				if (!container) return;

				var relativeY = e.pageY - containerTop;
				var firstRow;

				if (_this.height > container.clientHeight && container.clientHeight - _this.size > 0) {
					/* The map scrolls, so map the position onto the rows. */
					var H = container.clientHeight;
					var sliderHeight = _this.size;
					var ratio = (relativeY - sliderHeight / 2) / (H - sliderHeight);
					ratio = Math.min(Math.max(0, ratio), 1);
					firstRow = Math.round(ratio * (_this.length - _this.lines));
				} else {
					var offset = relativeY - _this.size / 2;
					offset = Math.min(Math.max(0, offset), _this.height - _this.size);
					firstRow = Math.round(offset / (_this.height / _this.length));
				}

				_this.active.scrollToRow(firstRow);
			};

			/* Delegated, so it keeps working if the markup is re-created and
			 * never registers twice. */
			$(document).off('mousedown.minimap').on('mousedown.minimap', '#minimap', function(e) {
				if (e.which !== 1) return; // Only left click
				var container = _this.minimap.length ? _this.minimap[0] : null;
				if (!container) return;

				dragging = true;
				containerTop = container.getBoundingClientRect().top + window.pageYOffset;

				handleDrag(e);
				e.preventDefault();
			});

			$(window).off('mousemove.minimap').on('mousemove.minimap', function(e) {
				if (dragging) handleDrag(e);
			});

			$(window).off('mouseup.minimap').on('mouseup.minimap', function() {
				dragging = false;
			});

			$(window).off('blur.minimap').on('blur.minimap', function() {
				dragging = false;
			});
		},

		//////////////////////////////////////////////////////////////////
		//
		// Re-inject the markup, the editor region was re-created
		//
		//////////////////////////////////////////////////////////////////

		recreate: function() {
			$('#editor-top-bar').before(this.template);
			this.minimap = $('#minimap');
			this.overlay = $('#minimap .overlay');
			this.code = $('#minimap code');
			this.pre = $('#minimap pre');
			this.bindDrag();
		},

		//////////////////////////////////////////////////////////////////
		//
		// Watch the ace container for theme class changes
		//
		//////////////////////////////////////////////////////////////////

		observeTheme: function() {
			if (!global.MutationObserver) return;

			var _this = this;
			var observer = new MutationObserver(function() {
				_this.updateThemeStyles(true);
			});

			var observe = function() {
				var editors = document.querySelectorAll('.ace_editor');
				for (var i = 0; i < editors.length; i++) {
					observer.observe(editors[i], {attributes: true, attributeFilter: ['class']});
				}
			};
			observe();

			/* Pick up panes created later on. */
			var original = codiad.editor.addInstance;
			if (typeof original === 'function' && !original._minimap) {
				var wrapped = function() {
					var instance = original.apply(this, arguments);
					observe();
					return instance;
				};
				wrapped._minimap = true;
				codiad.editor.addInstance = wrapped;
			}
		},

		//////////////////////////////////////////////////////////////////
		//
		// Apply the colors of the active editor theme
		//
		// Parameters:
		//   force - {Boolean} repaint even if the theme did not change
		//
		//////////////////////////////////////////////////////////////////

		updateThemeStyles: function(force) {
			var themeName = (codiad.editor && codiad.editor.settings)
				? codiad.editor.settings.theme : '';

			if (!force && themeName === this.currentTheme) return;
			this.currentTheme = themeName;

			if (!themeName || !this.presets) return;

			var preset = this.presets['ace/theme/' + themeName];
			if (!preset) return;

			var css = '';

			/* Default foreground, covers whitespace and anything unstyled. */
			if (preset.nam) {
				css += '#minimap pre { color: ' + preset.nam + '; }\n';
			}

			for (var cls in this.tokenClasses) {
				var color = preset[this.tokenClasses[cls]];
				if (!color) continue;
				css += '.' + cls + ' { color: ' + color + '; }\n';
			}

			/* Light themes need a slightly stronger viewport marker. */
			if (preset._dark === false) {
				css += '#minimap .overlay { background-color: rgba(0, 0, 0, 0.08); }\n';
			}

			if (!this.styleEl) {
				this.styleEl = document.createElement('style');
				this.styleEl.id = 'minimap-theme-colors';
				document.getElementsByTagName('head')[0].appendChild(this.styleEl);
			}
			this.styleEl.textContent = css;
		},

		//////////////////////////////////////////////////////////////////
		//
		// Load the stored color presets
		//
		//////////////////////////////////////////////////////////////////

		loadPresets: function() {
			var _this = this;

			$.get(this.path + this.controller + '?action=load', function(data) {
				var response = codiad.jsend.parse(data);
				if (!response || response === 'error') return;
				_this.presets = response;
				_this.updateThemeStyles(true);
			});
		},

		//////////////////////////////////////////////////////////////////
		//
		// Rebuild and store the color presets
		//
		//////////////////////////////////////////////////////////////////

		generatePresets: function() {
			var _this = this;
			var output = $('#minimap-gen-output');
			var button = $('#minimap-gen-btn');

			if (output.length) {
				output.css('display', 'block').text('Generating presets...');
			}
			if (button.length) {
				button.prop('disabled', true);
			}

			$.post(this.path + this.controller + '?action=generate', {}, function(data) {
				var response = codiad.jsend.parse(data);
				if (button.length) {
					button.prop('disabled', false);
				}
				if (output.length) {
					if (response === 'error') {
						output.text('ERROR');
						return;
					}
					output.text(response);
				}
				_this.loadPresets();
			}).fail(function() {
				if (button.length) {
					button.prop('disabled', false);
				}
				if (output.length) {
					output.text('ERROR: request failed');
				}
			});
		},

		//////////////////////////////////////////////////////////////////
		//
		// Wire the settings panel, called from dialog.php
		//
		//////////////////////////////////////////////////////////////////

		bindSettings: function() {
			var _this = this;
			$('#minimap-gen-btn').off('click.minimap').on('click.minimap', function() {
				_this.generatePresets();
			});
		}
	};

})(this, jQuery);
