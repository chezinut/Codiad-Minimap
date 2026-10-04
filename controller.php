<?php
/*
*  Copyright (c) CheziNut, distributed
*  as-is and without warranty under the MIT License. See
*  [root]/license.txt for more information. This information must remain intact.
*
*  Originally based on the Atheos Minimap plugin (MIT), see LICENSE.md.
*/

require_once('../../common.php');
require_once('class.presets.php');

checkSession();

/* Presets are derived from the local ACE build, so they belong in the
 * data directory rather than next to the plugin files. */
define('MINIMAP_PRESETS_FILE', 'presets.json');
define('MINIMAP_PRESETS_NS', 'minimap');

$action = isset($_GET['action']) ? $_GET['action'] : 'load';

switch ($action) {

//////////////////////////////////////////////////////////////////
// Rebuild the presets from the bundled ACE themes
//////////////////////////////////////////////////////////////////

	case 'generate':
		$presets = new Presets();
		$data = $presets->build();

		if (empty($data)) {
			die(formatJSEND('error', 'No ACE themes found'));
		}

		if (!is_dir(DATA . '/' . MINIMAP_PRESETS_NS)
			&& !@mkdir(DATA . '/' . MINIMAP_PRESETS_NS)) {
			die(formatJSEND('error', 'Cannot create ' . DATA . '/' . MINIMAP_PRESETS_NS));
		}

		saveJSON(MINIMAP_PRESETS_FILE, $data, MINIMAP_PRESETS_NS);

		$report = count($data) . ' theme(s) generated.';
		if (!empty($presets->skipped)) {
			$report .= ' Skipped: ' . implode('; ', $presets->skipped);
		}

		echo formatJSEND('success', $report);
		break;

//////////////////////////////////////////////////////////////////
// Return the stored presets, generating them once if missing
//////////////////////////////////////////////////////////////////

	case 'load':
		$data = getJSON(MINIMAP_PRESETS_FILE, MINIMAP_PRESETS_NS);

		if (empty($data)) {
			/* First run after install: serve freshly derived presets
			 * without writing anything, the user can persist them from
			 * the settings panel. */
			$presets = new Presets();
			$data = $presets->build();
		}

		if (empty($data)) {
			die(formatJSEND('error', 'No presets available'));
		}

		echo formatJSEND('success', $data);
		break;

//////////////////////////////////////////////////////////////////
// Report whether stored presets exist
//////////////////////////////////////////////////////////////////

	case 'check':
		echo formatJSEND('success', array(
			'exists' => !empty(getJSON(MINIMAP_PRESETS_FILE, MINIMAP_PRESETS_NS))
		));
		break;

	default:
		echo formatJSEND('error', 'Invalid action');
		break;
}
?>
