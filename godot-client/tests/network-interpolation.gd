extends SceneTree

const Motion = preload("res://multiplayer/snapshot_motion.gd")
const Squad = preload("res://multiplayer/remote_squad.gd")


func _initialize() -> void:
	_run.call_deferred()


func _run() -> void:
	var first := {
		"position": [0, 1, 0],
		"velocity": [0, 0, 0],
		"yaw": deg_to_rad(170),
	}
	var second := {
		"position": [5, 1, 0],
		"velocity": [10, -10, 0],
		"yaw": deg_to_rad(-170),
	}
	var samples: Array[Dictionary] = [
		{"recv_ms": 100, "state": first},
		{"recv_ms": 150, "state": second},
	]
	var earlier := Motion.sample(samples, 75)
	var midpoint := Motion.sample(samples, 125)
	var capped := Motion.sample(samples, 450)
	if not (
		earlier.position == Vector3(0, 1, 0)
		and midpoint.position == Vector3(2.5, 1, 0)
		and is_equal_approx(absf(midpoint.yaw), PI)
		and (capped.position as Vector3).is_equal_approx(Vector3(6.8, 0, 0))
	):
		push_error("Remote interpolation must bracket, wrap yaw and bound extrapolation.")
		quit(1)
		return
	var squad := Squad.new()
	root.add_child(squad)
	var connected := {
		"position": [5, 0, 3],
		"velocity": [0, 0, 0],
		"yaw": 0.0,
		"anim": "Idle",
		"nickname": "Ranger",
		"connected": true,
		"leftHook": {"active": true, "anchor": [5, 12, 3]},
	}
	squad.sync_players({"local": connected, "remote": connected}, "local")
	await process_frame
	await process_frame
	if squad.get_child_count() != 1:
		push_error("Only connected non-local players should receive scene nodes.")
		quit(1)
		return
	var avatar := squad.get_child(0) as Node3D
	var skeleton := avatar.find_child("Skeleton3D", true, false) as Skeleton3D
	var wire := avatar.get_node("LeftCable") as MeshInstance3D
	var anchor := avatar.get_node("LeftAnchor") as MeshInstance3D
	var winch := avatar.find_child("LeftWinch", true, false) as Node3D
	if not (
		skeleton != null and skeleton.get_bone_count() == 32
		and wire.visible and anchor.global_position == Vector3(5, 12, 3)
		and wire.global_position.distance_to(winch.global_position.lerp(anchor.global_position, 0.5)) < 0.03
	):
		push_error("The remote actor must instantiate the source rig and draw its cable from the winch.")
		quit(1)
		return
	var disconnected := connected.duplicate()
	disconnected.connected = false
	squad.sync_players({"remote": disconnected}, "local")
	if squad.get_child_count() != 0:
		push_error("Disconnected player replicas must be removed.")
		quit(1)
		return
	print("Remote interpolation, rig, ODM cable and removal passed")
	quit()
