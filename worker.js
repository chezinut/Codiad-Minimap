/*jshint worker:true*/
/*
* Copyright (c) 
* as-is and without warranty under the MIT License.
* See http://opensource.org/licenses/MIT for more information.
* This information must remain intact.
* Lumin (lumin.js) - Copyright (c)  MIT License.
*/
importScripts('lumin.js');

self.addEventListener('message', function(e) {
	var code = e.data.code;
	// Lumin is language agnostic, no mode needed.
	code = Lumin.highlight(code);
	//Post result
	postMessage({code: code});
}, false);
