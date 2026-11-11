class_name TitanMission
extends Node3D

signal spawned(actor: TitanActor)
signal finished(success: bool)

const Titan := preload("res://combat/titan.gd")
const GameData := preload("res://resources/game_data.gd")
const DRILLS := [
	["Ground locomotion & jump", "Use WASD to move through the plaza and Space to jump."],
	["Dual ODM grappling hooks", "Aim at a tower or building. Hold either mouse button, or Z / X, to grapple."],
	["Pendulum swing & gas boost", "Hold Shift while swinging to ignite the gas thruster."],
	["Target lock-on & approach", "Approach the training Titan on North Avenue. Press Tab to lock on."],
	["Execute a Nape strike", "Swing behind the Titan and press F near its Nape. Use V for a Thunder Spear."],
]
const HUNT_ROSTERS := [["normal", "normal", "abnormal"], ["normal", "abnormal", "abnormal", "large"]]

var actors: Array[TitanActor] = []
var mode := ""
var elapsed := 0.0
var kills := 0
var wave := 1
var score := 0
var stage := 0
var target_kills := 7
var max_waves := 2
var _room_rank := ""
var is_finished := false
var _id_counter := 0
var _rng := RandomNumberGenerator.new()

func start(kind: String, spawn_points: Array[Vector3]) -> void:
	clear()
	mode = kind
	elapsed = 0.0
	kills = 0
	wave = 1
	score = 0
	stage = 0
	target_kills = 1 if kind == "training" else 7
	max_waves = 1 if kind == "training" else 2
	_room_rank = ""
	is_finished = false
	match mode:
		"training":
			_spawn("training_dummy", "normal", Vector3(0, 0, -45), 8.0, true, false)
		"hunt":
			_spawn_wave(spawn_points)

func clear() -> void:
	for actor in actors:
		actor.queue_free()
	actors.clear()

func step(delta: float, feet: Vector3, velocity: Vector3, loud: bool, grounded: bool,
		grapples: int, boost_time: float, locked: bool, rings: int, patrol_points: Array[Vector3]) -> void:
	if is_finished or mode.is_empty():
		return
	if mode != "coop":
		elapsed += delta
	for index in range(actors.size() - 1, -1, -1):
		var actor := actors[index]
		actor.step(delta, feet, loud, patrol_points)
		if actor.removed:
			actor.queue_free()
			actors.remove_at(index)
	if mode != "training":
		return
	score += rings * 200
	match stage:
		0:
			if (Vector2(velocity.x, velocity.z).length() > 4 or not grounded) and elapsed > 1.2:
				stage = 1
		1:
			if grapples >= 2:
				stage = 2
		2:
			if boost_time >= 0.45:
				stage = 3
		3:
			if locked or feet.z < -20.0:
				stage = 4

func register_hit(actor: TitanActor, outcome: Dictionary, combo: int, spawn_points: Array[Vector3]) -> void:
	if is_finished or mode == "coop":
		return
	if outcome.broken:
		score += 350
	if not outcome.killed:
		return
	kills += 1
	var multiplier := minf(3.0, 1.0 + (combo - 1) * 0.25)
	score += roundi(float(actor.config.scoreValue) * float(outcome.multiplier) * multiplier)
	if mode == "training":
		score += 1500
		end(true)
	elif kills >= target_kills:
		score += maxi(0, roundi((300.0 - elapsed) * 15.0))
		end(true)
	elif wave == 1 and kills == 3:
		wave += 1
		_spawn_wave(spawn_points)

func end(success: bool) -> void:
	if is_finished:
		return
	is_finished = true
	finished.emit(success)

func sync_room(snapshot: Dictionary) -> void:
	if mode != "coop":
		return
	elapsed = float(snapshot.elapsedSeconds)
	kills = int(snapshot.totalKills)
	wave = int(snapshot.wave)
	score = int(snapshot.teamScore)
	target_kills = int(snapshot.targetKills)
	max_waves = int(snapshot.maxWaves)
	_room_rank = str(snapshot.rank)
	var snapshots: Dictionary = snapshot.titans
	for index in range(actors.size() - 1, -1, -1):
		var actor := actors[index]
		if not snapshots.has(actor.actor_id):
			actor.queue_free()
			actors.remove_at(index)
	for id: String in snapshots:
		var remote: Dictionary = snapshots[id]
		var actor := actor_for(id)
		if actor == null:
			actor = _spawn(id, remote.variant, GameData.vec(remote.position), remote.heightMeters, false, true)
		actor.apply_snapshot(remote)

func actor_for(id: String) -> TitanActor:
	for actor in actors:
		if actor.actor_id == id:
			return actor
	return null

func title() -> String:
	if mode == "training":
		return "CADET PROVING GROUNDS"
	if mode == "coop":
		return "VANGUARD CO-OP  /  WAVE %s OF %s" % [wave, max_waves]
	return "DEFENSE OF VALKENBURG  /  WAVE %s OF %s" % [wave, max_waves]

func objective() -> String:
	if mode == "training":
		return "%s / 5    %s" % [stage + 1, DRILLS[stage][0]]
	return "Eliminate district Titans  %s / %s" % [kills, target_kills]

func detail() -> String:
	if mode == "training":
		return DRILLS[stage][1]
	if mode == "coop":
		return "G Ping  ·  1–4 Quick chat  ·  Hold E to revive"
	return "Aim for the Nape from behind. Press R at a cyan supply depot."

func rank() -> String:
	if mode == "coop" and not _room_rank.is_empty():
		return _room_rank
	if mode == "training" or score >= 8500:
		return "S"
	if score >= 5500:
		return "A"
	return "B" if score >= 3000 else "C"

func _spawn_wave(points: Array[Vector3]) -> void:
	var roster: Array = HUNT_ROSTERS[wave - 1]
	var configs: Dictionary = GameData.get_data().config.titans
	for index in roster.size():
		var kind: String = roster[index]
		var point := points[(index + wave * 2) % points.size()]
		point += Vector3(_rng.randf_range(-6, 6), 0, _rng.randf_range(-6, 6))
		var config: Dictionary = configs[kind]
		_id_counter += 1
		var actor := _spawn("titan_%s" % _id_counter, kind, point, _rng.randf_range(config.minHeight, config.maxHeight), false, false)
		actor.rotation.y = atan2(-point.x, -point.z)

func _spawn(id: String, kind: String, feet: Vector3, height: float, dummy: bool, remote: bool) -> TitanActor:
	var actor := Titan.new()
	actor.configure(id, kind, height, dummy, remote)
	actor.position = feet
	add_child(actor)
	actors.append(actor)
	spawned.emit(actor)
	return actor
