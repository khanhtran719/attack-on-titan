extends Node
## Chooses source locomotion clips and keeps attack/dodge/hit transitions centralized.

const ONE_SHOTS: Array[StringName] = [
	&"Jump", &"Landing", &"Dodge", &"LightAttack", &"HeavyAttack", &"HitReaction", &"Death"
]

var current: StringName = &"Idle"
var _remaining: float = 0.0
var _tree: AnimationTree
var _transition: AnimationNodeTransition
var _durations: Dictionary = {}


func setup(imported_model: Node3D) -> void:
	var players := imported_model.find_children("*", "AnimationPlayer", true, false)
	if players.is_empty():
		return
	var source := players[0] as AnimationPlayer
	var names := source.get_animation_list()
	var clips: Array[StringName] = []
	for clip in names:
		if clip != "RESET":
			clips.append(StringName(clip))
	if clips.is_empty():
		return

	var blend_tree := AnimationNodeBlendTree.new()
	_transition = AnimationNodeTransition.new()
	_transition.xfade_time = 0.16
	_transition.allow_transition_to_self = true
	_transition.input_count = clips.size()
	blend_tree.add_node(&"State", _transition)
	for index in clips.size():
		var clip := clips[index]
		var animation := source.get_animation(clip)
		animation.loop_mode = Animation.LOOP_NONE if clip in ONE_SHOTS else Animation.LOOP_LINEAR
		_durations[clip] = animation.length
		var animation_node := AnimationNodeAnimation.new()
		animation_node.animation = clip
		blend_tree.add_node(clip, animation_node)
		_transition.set_input_name(index, str(clip))
		_transition.set_input_reset(index, true)
		blend_tree.connect_node(&"State", index, clip)
	blend_tree.connect_node(&"output", 0, &"State")

	_tree = AnimationTree.new()
	_tree.active = false
	source.get_parent().add_child(_tree)
	var target_root := source.get_node(source.root_node)
	_tree.root_node = _tree.get_path_to(target_root)
	_tree.anim_player = _tree.get_path_to(source)
	_tree.tree_root = blend_tree
	_tree.callback_mode_process = AnimationMixer.ANIMATION_CALLBACK_MODE_PROCESS_MANUAL
	_tree.active = true
	_play(&"Idle", 0.0, true)
	_tree.advance(0.0)


func reset() -> void:
	_remaining = 0.0
	_play(&"Idle", 0.0, true)
	if _tree != null:
		_tree.advance(0.0)


func play_action(clip: StringName, duration: float = -1.0) -> void:
	if current == &"Death" and clip != &"Death":
		return
	if _tree != null and not _durations.has(clip):
		return
	_remaining = duration if duration >= 0.0 else float(_durations.get(clip, 0.4)) * 0.92
	_play(clip, 0.08 if clip != &"Death" else 0.12, true)


func update_state(
	dt: float, on_ground: bool, speed: float, vertical_speed: float,
	boost: bool, hook_left: bool, hook_right: bool
) -> void:
	_remaining = maxf(0.0, _remaining - dt)
	if _remaining <= 0.0 and current != &"Death":
		var state := _locomotion(on_ground, speed, vertical_speed, boost, hook_left, hook_right)
		_play(state, 0.14 if on_ground else 0.16)
	if _tree != null:
		_tree.advance(dt)


func _locomotion(on_ground: bool, speed: float, vertical_speed: float, boost: bool, left: bool, right: bool) -> StringName:
	if on_ground:
		if speed < 0.5:
			return &"Idle"
		if speed < 6.8:
			return &"Walk"
		return &"Run" if speed < 11.2 else &"Sprint"
	if boost:
		return &"Boost"
	if left and right:
		return &"Swing" if speed > 14.0 else &"DualHook"
	if left or right:
		if speed > 16.0:
			return &"Swing"
		return &"LeftHook" if left else &"RightHook"
	return &"Fall" if vertical_speed < -4.0 else &"AirborneIdle"


func _play(clip: StringName, fade: float, restart: bool = false) -> void:
	if clip == current and not restart:
		return
	current = clip
	if _tree != null and _durations.has(clip):
		_transition.xfade_time = fade
		_tree.set("parameters/State/transition_request", str(clip))
