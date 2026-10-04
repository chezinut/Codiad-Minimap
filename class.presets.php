<?php
/*
*  Copyright (c) CheziNut distributed
*  as-is and without warranty under the MIT License. See
*  [root]/license.txt for more information. This information must remain intact.
*
*  Extracts per-theme minimap token colors out of the bundled ACE themes so
*  the minimap can mirror whatever editor theme is active.
*
*  Originally based on the Atheos Minimap plugin (MIT), see LICENSE.md.
*/

//////////////////////////////////////////////////////////////////
// Presets
//////////////////////////////////////////////////////////////////

class Presets {

//////////////////////////////////////////////////////////////////
// PROPERTIES
//////////////////////////////////////////////////////////////////

	/* Directory holding the bundled ACE themes. */
	private $themeDir;

	/* Theme list for which no preset could be derived. */
	public $skipped = array();

//////////////////////////////////////////////////////////////////
// Token map
//
// For every minimap token class (ll-<token>) the ordered list of ACE
// token selectors to look for. The first one present in the theme
// wins, so more specific selectors must come first.
//////////////////////////////////////////////////////////////////

	private static $tokens = array(
		'nam' => array(),
		'var' => array('.ace_variable.ace_language', '.ace_support.ace_type', '.ace_variable'),
		'con' => array('.ace_support.ace_function', '.ace_entity.ace_name.ace_function', '.ace_support.ace_constant'),
		'bol' => array('.ace_constant.ace_language.ace_boolean', '.ace_constant.ace_language', '.ace_support.ace_constant'),
		'num' => array('.ace_constant.ace_numeric.ace_integer', '.ace_constant.ace_numeric.ace_float', '.ace_constant.ace_numeric', '.ace_constant'),
		'str' => array('.ace_constant.ace_character.ace_escape', '.ace_constant.ace_character', '.ace_string'),
		'rex' => array('.ace_string.ace_regexp', '.ace_regexp'),
		'pct' => array('.ace_keyword.ace_operator.ace_word', '.ace_keyword.ace_operator', '.ace_meta.ace_punctuation'),
		'brc' => array('.ace_paren.ace_brace', '.ace_entity.ace_name.ace_tag', '.ace_brace', '.ace_paren'),
		'key' => array('.ace_keyword', '.ace_storage'),
		'com' => array('.ace_comment.ace_doc', '.ace_comment')
	);

	/* Used to fill tokens a theme does not define, so every preset is
	 * complete and the minimap keeps a consistent look. */
	private static $fill = array(
		'rex' => 'str',
		'bol' => 'key',
		'con' => 'key',
		'pct' => 'str',
		'brc' => 'nam',
		'var' => 'nam'
	);

	/* Emission order, also the order used by screen.css. */
	private static $order = array('nam', 'var', 'con', 'bol', 'num', 'str', 'rex', 'pct', 'brc', 'key', 'com');

//////////////////////////////////////////////////////////////////
// CONSTRUCT
//////////////////////////////////////////////////////////////////

	public function __construct($themeDir = null) {
		$this->themeDir = $themeDir !== null ? $themeDir : COMPONENTS . '/editor/ace-editor';
	}

//////////////////////////////////////////////////////////////////
// Build presets for every bundled theme
//////////////////////////////////////////////////////////////////

	public function build() {
		$presets = array();
		$this->skipped = array();

		$files = glob($this->themeDir . '/theme-*.js');
		if ($files === false) {
			return $presets;
		}

		/* Some themes (textmate) keep their CSS in ace.js itself. */
		$ace = $this->read($this->themeDir . '/ace.js');

		foreach ($files as $file) {
			$id = self::themeId($file);
			if ($id === null) {
				$this->skipped[] = basename($file) . ': no ace/theme id';
				continue;
			}

			$raw = $this->read($file);
			$css = self::cssText($raw);

			if ($css === null) {
				$css = self::cssTextOfModule($ace, $id);
			}
			if ($css === null) {
				$this->skipped[] = $id . ': no cssText';
				continue;
			}

			$presets['ace/theme/' . $id] = $this->tokens($raw, $css);
		}

		ksort($presets);

		return $presets;
	}

//////////////////////////////////////////////////////////////////
// Derive the token colors of a single theme
//////////////////////////////////////////////////////////////////

	private function tokens($raw, $css) {
		$dark = preg_match('/\.isDark\s*=\s*!0/', $raw) ? true : false;

		$cssClass = 'ace-tm';
		if (preg_match('/\.cssClass\s*=\s*["\']([^"\']+)["\']/', $raw, $m)) {
			$cssClass = $m[1];
		}

		/* Index the theme rules by selector, with the theme prefix
		 * removed so the lookups do not depend on the theme name. */
		$rules = array();
		$base = null;
		foreach (self::parseRules($css) as $selector => $color) {
			$stripped = self::stripPrefix($selector, $cssClass);
			if ($stripped === '') {
				$base = $color;
				continue;
			}
			$rules[$stripped] = $color;
		}

		/* Default foreground, used for tokens the theme leaves out. */
		if ($base === null) {
			$base = $dark ? '#f8f8f8' : '#000000';
		}

		$colors = array();
		foreach (self::$tokens as $token => $selectors) {
			$colors[$token] = $selectors
				? self::resolve($rules, $selectors, $base)
				: $base;
		}

		/* Second pass: nothing should be left undefined. */
		foreach (self::$fill as $token => $source) {
			if (empty($colors[$token])) {
				$colors[$token] = $colors[$source];
			}
		}

		$preset = array();
		foreach (self::$order as $token) {
			$preset[$token] = $colors[$token];
		}
		$preset['_dark'] = $dark;

		return $preset;
	}

//////////////////////////////////////////////////////////////////
// {Private} Resolve a token from the theme rules
//////////////////////////////////////////////////////////////////

	private static function resolve($rules, $selectors, $fallback) {
		/* Exact match on the selector. */
		foreach ($selectors as $selector) {
			if (isset($rules[$selector])) {
				return $rules[$selector];
			}
		}

		/* Themes group selectors loosely, fall back on the most
		 * specific rule that mentions the token. */
		foreach ($selectors as $selector) {
			$color = null;
			$length = 0;
			foreach ($rules as $rule => $ruleColor) {
				if (strpos($rule, $selector) !== false && strlen($rule) > $length) {
					$color = $ruleColor;
					$length = strlen($rule);
				}
			}
			if ($color !== null) {
				return $color;
			}
		}

		return $fallback;
	}

//////////////////////////////////////////////////////////////////
// {Private} Extract every color declaration, keyed by selector
//////////////////////////////////////////////////////////////////

	private static function parseRules($css) {
		$rules = array();

		if (!preg_match_all('/([^{}]+)\{([^{}]*)\}/', $css, $sets, PREG_SET_ORDER)) {
			return $rules;
		}

		foreach ($sets as $set) {
			if (!preg_match('/(?:^|;)\s*color\s*:\s*([^;]+)/i', $set[2], $m)) {
				continue;
			}
			$color = trim($m[1]);
			if ($color === '' || stripos($color, 'var(') !== false) {
				continue;
			}
			foreach (preg_split('/\s*,\s*/', trim($set[1])) as $selector) {
				$selector = trim(preg_replace('/\s+/', ' ', $selector));
				if ($selector !== '') {
					$rules[$selector] = $color;
				}
			}
		}

		return $rules;
	}

	//////////////////////////////////////////////////////////////////
	// {Private} Remove the leading theme selector of a rule
	//////////////////////////////////////////////////////////////////

	private static function stripPrefix($selector, $cssClass) {
		$base = '.' . $cssClass;
		if ($selector === $base) {
			return '';
		}
		if (strpos($selector, $base) === 0 && strlen($selector) > strlen($base)) {
			$next = $selector[strlen($base)];
			if ($next === ' ' || $next === '>' || $next === '+' || $next === '~') {
				return ltrim(substr($selector, strlen($base)), " \t>+~");
			}
		}
		return $selector;
	}

	//////////////////////////////////////////////////////////////////
	// {Private} Read the ace/theme/<id> a theme file registers
	//////////////////////////////////////////////////////////////////

	private static function themeId($file) {
		$raw = self::read($file);
		if ($raw === null) {
			return null;
		}
		if (!preg_match_all('/ace\.define\(\s*["\']ace\/theme\/([^"\']+)["\']/', $raw, $m)) {
			return null;
		}
		$ids = array();
		foreach ($m[1] as $id) {
			/* Skip the companion "<id>-css" module. */
			if (substr($id, -4) !== '-css') {
				$ids[] = $id;
			}
		}
		return count($ids) ? $ids[count($ids) - 1] : null;
	}

//////////////////////////////////////////////////////////////////
// {Private} Pull the cssText literal out of an ACE module
//////////////////////////////////////////////////////////////////

	private static function cssTextOfModule($raw, $id) {
		if ($raw === null) {
			return null;
		}
		$pattern = '/ace\.define\(\s*["\']ace\/theme\/' . preg_quote($id, '/') . '-css["\']'
			. '.*?n\.exports\s*=\s*["\'](.+?)["\']\s*[,\)]/s';
		if (!preg_match($pattern, $raw, $m)) {
			return null;
		}
		return self::unescape($m[1]);
	}

//////////////////////////////////////////////////////////////////
// {Private} Pull the cssText literal out of a theme file
//////////////////////////////////////////////////////////////////

	private static function cssText($raw) {
		if ($raw === null) {
			return null;
		}
		$patterns = array(
			'/n\.exports\s*=\s*["\'](.+?)["\']\s*[,\)]/',
			'/exports\.cssText\s*=\s*["`](.+?)["`]/',
			'/n\.exports\s*=\s*["`](.+?)["`]/'
		);
		foreach ($patterns as $pattern) {
			if (preg_match($pattern, $raw, $m)) {
				return self::unescape($m[1]);
			}
		}
		return null;
	}

//////////////////////////////////////////////////////////////////
// {Private} Unescape a JavaScript string literal
//////////////////////////////////////////////////////////////////

	private static function unescape($value) {
		return str_replace(
			array("\\n", "\\t", '\\"', "\\'"),
			array("\n", "\t", '"', "'"),
			$value
		);
	}

//////////////////////////////////////////////////////////////////
// {Private} Read a file without leaking warnings
//////////////////////////////////////////////////////////////////

	private static function read($file) {
		if (!file_exists($file)) {
			return null;
		}
		$content = @file_get_contents($file);
		return $content === false ? null : $content;
	}
}
?>
