extends SceneTree

const Feedback := preload("res://combat/effects.gd")
const Cues := preload("res://audio/cues.gd")
const DURATIONS := {
	"hook_left": 0.18, "hook_right": 0.18, "hook_latch": 0.10, "gas": 0.18,
	"light_slash": 0.26, "heavy_slash": 0.26, "impact": 0.35, "critical": 0.35,
	"glance": 0.35, "titan_step": 0.25, "titan_roar": 0.80, "resupply": 0.365,
	"spear_launch": 0.23, "explosion": 0.52, "grab_escape": 0.21,
}

var _failures := 0


func _initialize() -> void:
	call_deferred("_run")


func _run() -> void:
	await _check_audio()
	_check_effects()
	if _failures == 0:
		print("Feedback validation passed: 15 PCM cues, bounded effects and projectile mesh")
	quit(0 if _failures == 0 else 1)


func _check_audio() -> void:
	var cues := Cues.new()
	root.add_child(cues)
	for cue: String in DURATIONS:
		var stream := cues.stream_for(cue)
		_check(stream != null, cue + " has an AudioStreamWAV")
		if stream == null:
			continue
		_check(is_equal_approx(stream.get_length(), DURATIONS[cue]), cue + " duration")
		_check(cues.stream_for(cue) == stream, cue + " reuses cached PCM")
		var peak := 0
		var samples := stream.data
		for index in range(0, samples.size(), 2):
			peak = maxi(peak, absi(samples.decode_s16(index)))
		_check(peak > 400 and peak < 30000, cue + " is audible and unclipped")
	cues.play_cue("hook_left")
	cues.play_cue("hook_latch")
	cues.play_cue("critical", Vector3(10, 0, 10))
	var local_players := cues.find_children("*", "AudioStreamPlayer", false, false)
	var world_players := cues.find_children("*", "AudioStreamPlayer3D", false, false)
	_check(local_players[0].stream == cues.stream_for("hook_left"), "hook keeps its audio voice")
	_check(local_players[1].stream == cues.stream_for("hook_latch"), "latch has a distinct audio voice")
	_check(world_players[0].stream == cues.stream_for("critical"), "impact is assigned to a world voice")
	await create_timer(0.05).timeout
	for player in local_players + world_players:
		player.stop()
	await create_timer(0.05).timeout
	cues.free()


func _check_effects() -> void:
	var feedback := Feedback.new()
	root.add_child(feedback)
	var particles := feedback.find_children("*", "MultiMeshInstance3D", false, false)[0] as MultiMeshInstance3D
	var arcs := feedback.find_children("*", "MeshInstance3D", false, false)
	_check(particles.multimesh.instance_count == 64, "64 pooled puffs")
	_check(arcs.size() == 8, "8 pooled sweep arcs")
	for i in 6:
		feedback.burst(Vector3(0, 2, 0), "explosion")
	feedback.slash(Vector3.ZERO, 0.0, true)
	feedback.gas_puff(Vector3.UP, Vector3(8, 0, 0))
	feedback._process(0.01)
	_check(particles.multimesh.visible_instance_count == 64, "overlapping effects stay within pool")
	for arc: MeshInstance3D in arcs:
		_check(arc.visible, "arcs overwrite available pool slots")
	feedback._process(1.0)
	_check(particles.multimesh.visible_instance_count == 0, "puffs expire")
	for arc: MeshInstance3D in arcs:
		_check(not arc.visible, "arcs expire")
	_check(not feedback.is_processing(), "effect processing sleeps when the pool is idle")

	feedback.burst(Vector3(0, 2, 0), "impact")
	feedback.clear_effects()
	_check(not feedback.is_processing(), "reset clears active effects")
	var projectile := feedback.make_projectile()
	_check(projectile.get_child_count() == 2, "spear includes body and exhaust")
	projectile.free()
	feedback.free()


func _check(condition: bool, label: String) -> void:
	if not condition:
		printerr("FAIL: " + label)
		_failures += 1
