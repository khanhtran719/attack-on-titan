extends SceneTree
## Import the project before invoking this script.

const PLAYER_CLIPS := {
	"Idle": 1.6, "Walk": 0.9, "Run": 0.64, "Sprint": 0.48, "Jump": 0.45,
	"Fall": 0.8, "Landing": 0.32, "AirborneIdle": 1.0, "LeftHook": 0.5,
	"RightHook": 0.5, "DualHook": 0.5, "Swing": 0.7, "Boost": 0.4,
	"Dodge": 0.38, "LightAttack": 0.44, "HeavyAttack": 0.62, "HitReaction": 0.45,
	"Death": 1.1,
}
const TITAN_CLIPS := {
	"Idle": 2.4, "Walk": 1.4, "Run": 0.84, "Turn": 0.8, "Attack": 1.25, "Grab": 1.15,
	"Stagger": 1.2, "Injured": 1.6, "Fall": 0.9, "Death": 1.2,
}
const PLAYER_MARKERS := [
	"LeftWinch", "RightWinch", "ThrusterNozzle",
	"LeftSwordHilt", "LeftSwordTip", "RightSwordHilt", "RightSwordTip",
]
const TITAN_MARKERS := [
	"NapeWeakPointNode", "HeadZone", "LeftArmZone", "RightArmZone", "LeftLegZone", "RightLegZone",
]
# Measured from Three.AnimationMixer and Object3D.getWorldPosition in the original rigs.
const POSE_CASES := [
	["vanguard", "LightAttack", 0.22, "LeftSwordTip", Vector3(0.704913, 1.866534, 0.754819)],
	["vanguard", "Run", 0.16, "LeftWinch", Vector3(-0.25, 1.006003, 0.219439)],
	["titan_normal", "Attack", 0.50, "NapeWeakPointNode", Vector3(0.006296, 1.739454, -0.200174)],
	["titan_abnormal", "Stagger", 0.42, "HeadZone", Vector3(-0.046535, 1.869640, -0.150482)],
	["titan_large", "Grab", 0.56, "RightArmZone", Vector3(0.069494, 1.643220, 0.466733)],
]

var _failed := false


func _initialize() -> void:
	call_deferred("_run")


func _run() -> void:
	_check_asset("vanguard", 32, 7, PLAYER_CLIPS, PLAYER_MARKERS)
	for variant in ["normal", "abnormal", "large"]:
		_check_asset("titan_" + variant, 22, 1, TITAN_CLIPS, TITAN_MARKERS)

	for sample in POSE_CASES:
		_check_pose(sample)

	if not _failed:
		print("Rig validation passed: 4 scenes, 48 clips, 25 sockets and 5 source pose samples")
	quit(1 if _failed else 0)


func _instantiate(asset: String) -> Node3D:
	var scene := load("res://assets/%s.glb" % asset) as PackedScene
	if not _check(scene != null, "%s is an imported PackedScene" % asset):
		return null
	var rig := scene.instantiate() as Node3D
	root.add_child(rig)
	return rig


func _check_asset(
	asset: String, bones: int, surfaces: int, clips: Dictionary, markers: Array
) -> void:
	var rig := _instantiate(asset)
	if rig == null:
		return
	var skeleton := rig.find_child("Skeleton3D", true, false) as Skeleton3D
	if _check(skeleton != null, "%s has a Skeleton3D" % asset):
		_check(skeleton.get_bone_count() == bones, "%s preserves %d bones" % [asset, bones])

	var meshes := rig.find_children("*", "MeshInstance3D", true, false)
	var skinned: Array[MeshInstance3D] = []
	for candidate in meshes:
		var mesh := candidate as MeshInstance3D
		if mesh.skin != null:
			skinned.append(mesh)
	if _check(skinned.size() == 1, "%s has one skinned body mesh" % asset):
		var mesh := skinned[0]
		_check(mesh.skin.get_bind_count() == bones, "%s preserves inverse bind matrices" % asset)
		_check(mesh.mesh.get_surface_count() == surfaces, "%s preserves material slots" % asset)
		for surface in mesh.mesh.get_surface_count():
			var format := (mesh.mesh as ArrayMesh).surface_get_format(surface)
			var required := Mesh.ARRAY_FORMAT_BONES | Mesh.ARRAY_FORMAT_WEIGHTS | Mesh.ARRAY_FORMAT_COLOR
			_check((format & required) == required, "%s surface %d retains skin and color" % [asset, surface])

	var player := rig.find_child("AnimationPlayer", true, false) as AnimationPlayer
	if _check(player != null, "%s has an AnimationPlayer" % asset):
		_check(player.get_animation_list().size() == clips.size(), "%s clip count matches" % asset)
		for clip: String in clips:
			if _check(player.has_animation(clip), "%s has %s" % [asset, clip]):
				var actual := player.get_animation(clip).length
				_check(is_equal_approx(actual, clips[clip]), "%s %s clip duration" % [asset, clip])

	for marker: String in markers:
		var socket := rig.find_child(marker, true, false) as Node3D
		_check(socket != null and _attachment_for(socket) != null, "%s %s follows a bone" % [asset, marker])
	rig.free()


func _check_pose(sample: Array) -> void:
	var rig := _instantiate(sample[0])
	if rig == null:
		return
	var player := rig.find_child("AnimationPlayer", true, false) as AnimationPlayer
	var socket := rig.find_child(sample[3], true, false) as Node3D
	if player != null and player.has_animation(sample[1]) and socket != null:
		var attachment := _attachment_for(socket)
		if attachment != null:
			player.callback_mode_process = AnimationMixer.ANIMATION_CALLBACK_MODE_PROCESS_MANUAL
			player.play(sample[1])
			player.advance(0.0)
			player.seek(sample[2], true)
			attachment.on_skeleton_update()
			# The 30 Hz Godot import resamples source keys and can differ by a few millimeters.
			_check(socket.global_position.distance_to(sample[4]) < 0.008,
				"%s %s socket pose matches source within 8 mm, got %s" % [sample[0], sample[1], socket.global_position])
	rig.free()


func _attachment_for(node: Node) -> BoneAttachment3D:
	var ancestor := node.get_parent()
	while ancestor != null:
		if ancestor is BoneAttachment3D:
			return ancestor
		ancestor = ancestor.get_parent()
	return null


func _check(condition: bool, description: String) -> bool:
	if not condition:
		printerr("FAIL: " + description)
		_failed = true
	return condition
