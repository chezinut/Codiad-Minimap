<?php
require_once('../../common.php');
?>
<label><span class="icon-map big-icon"></span> <?php i18n("Minimap"); ?></label>
<hr>
<p style="margin-bottom:10px">
Rebuild the minimap color presets from the bundled ACE themes. Run this after adding or updating themes.
</p>
<button id="minimap-gen-btn">
<span class="icon-loop"></span> Regenerate Presets
</button>
<pre id="minimap-gen-output" style="margin-top:10px;max-height:200px;overflow:auto;padding:8px;border-radius:4px;display:none;font-size:11px;"></pre>
<script>
codiad.MiniMap.bindSettings();
</script>
