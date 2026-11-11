class_name TitanSave
extends RefCounted

const PATH := "user://vanguard.cfg"
const DEFAULT_SETTINGS := {
	"mouseSensitivity": 1.0, "cameraDistance": 5.8, "graphicsQuality": "high",
	"masterVolume": 0.7, "tacticalOverlayKey": "KeyH", "nickname": "Scout",
	"debug": {"showColliders": false, "showGrappleAnchors": false, "showTitanHitboxes": false,
		"showWeakPoints": false, "showVelocityVectors": false, "showAIStates": false, "showPerformanceOverlay": false},
}
const DEFAULT_PROGRESS := {
	"trainingCompleted": false, "highScore": 0, "bestRank": "-", "totalTitansSlain": 0, "fastestHuntSeconds": null,
}

var settings := DEFAULT_SETTINGS.duplicate(true)
var progress := DEFAULT_PROGRESS.duplicate(true)

func restore() -> void:
	var file := ConfigFile.new()
	if file.load(PATH) == OK:
		_read_settings(file.get_value("player", "settings", {}))
		_read_progress(file.get_value("player", "progress", {}))
	elif OS.has_feature("web"):
		var local := JavaScriptBridge.get_interface("localStorage")
		if local != null:
			_read_settings(_decode_legacy(local.getItem("titan_hunter_3d_settings_v1")))
			_read_progress(_decode_legacy(local.getItem("titan_hunter_3d_progress_v1")))
			var callsign = local.getItem("aot_mp_nickname")
			if callsign is String and not callsign.is_empty():
				settings.nickname = callsign.left(16)

func _decode_legacy(value: Variant) -> Variant:
	if not value is String or value.is_empty():
		return null
	var json := JSON.new()
	return json.data if json.parse(value) == OK else null

func _read_settings(value: Variant) -> void:
	if not value is Dictionary:
		return
	for key in settings:
		if key == "debug":
			continue
		if value.has(key) and typeof(value[key]) == typeof(settings[key]):
			settings[key] = value[key]
	if value.get("debug") is Dictionary:
		for key in settings.debug:
			if value.debug.get(key) is bool:
				settings.debug[key] = value.debug[key]
	settings.mouseSensitivity = clampf(settings.mouseSensitivity, 0.2, 3.0)
	settings.cameraDistance = clampf(settings.cameraDistance, 3.0, 10.0)
	settings.masterVolume = clampf(settings.masterVolume, 0.0, 1.0)
	if settings.graphicsQuality not in ["low", "medium", "high"]:
		settings.graphicsQuality = "high"

func _read_progress(value: Variant) -> void:
	if not value is Dictionary:
		return
	for key in progress:
		if value.has(key) and (typeof(value[key]) == typeof(progress[key]) or value[key] is float and progress[key] is int):
			progress[key] = value[key]
	if value.get("fastestHuntSeconds") is float or value.get("fastestHuntSeconds") is int:
		progress.fastestHuntSeconds = value.fastestHuntSeconds

func persist() -> void:
	var file := ConfigFile.new()
	file.set_value("player", "settings", settings)
	file.set_value("player", "progress", progress)
	var result := file.save(PATH)
	if result != OK:
		push_warning("Unable to write Vanguard progress (%s)" % result)

func record(mode: String, score: int, rank: String, kills: int, elapsed: float) -> void:
	if mode == "training":
		progress.trainingCompleted = true
	else:
		if score > progress.highScore:
			progress.highScore = score
			progress.bestRank = rank
		if progress.fastestHuntSeconds == null or elapsed < float(progress.fastestHuntSeconds):
			progress.fastestHuntSeconds = snappedf(elapsed, 0.1)
	progress.totalTitansSlain += kills
	persist()
