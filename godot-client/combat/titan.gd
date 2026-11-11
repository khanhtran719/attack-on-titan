class_name TitanActor
extends Node3D

signal strike(actor: TitanActor, grab: bool, point: Vector3, radius: float, damage: float)
signal cue(name: String, point: Vector3)

const GameData := preload("res://resources/game_data.gd")
const ZONE_ORDER := ["Nape", "LeftLeg", "RightLeg", "LeftArm", "RightArm", "Head"]
const MARKERS := {
	"Nape": "NapeWeakPointNode", "Head": "HeadZone", "LeftArm": "LeftArmZone",
	"RightArm": "RightArmZone", "LeftLeg": "LeftLegZone", "RightLeg": "RightLegZone",
}
const RADII := {
	"Nape": Vector2(1.35, 1.45), "Head": Vector2(0.85, 0.95),
	"LeftArm": Vector2(0.8, 0.9), "RightArm": Vector2(0.8, 0.9),
	"LeftLeg": Vector2(0.85, 0.98), "RightLeg": Vector2(0.85, 0.98),
}

var actor_id := ""
var variant := "normal"
var height_meters := 8.0
var dummy := false
var replicated := false
var zones: Dictionary = {}
var state := "Idle"
var velocity := Vector3.ZERO
var removed := false
var config: Dictionary
var animation: AnimationPlayer
var _clip := ""
var _timer := 0.0
var _death_age := 0.0
var _patrol_target := Vector3.ZERO
var _hit_emitted := false
var _foot_distance := 0.0
var _weave_age := 0.0
var _replica: Dictionary = {}
var _rig: Node3D

func configure(id: String, kind: String, height: float, is_dummy: bool, remote := false) -> void:
	actor_id = id
	variant = kind
	height_meters = height
	dummy = is_dummy
	replicated = remote
	config = GameData.get_data().config.titans[variant]

func _ready() -> void:
	var scene := load("res://assets/titan_%s.glb" % variant) as PackedScene
	_rig = scene.instantiate() as Node3D
	_rig.scale = Vector3.ONE * height_meters / 2.0
	add_child(_rig)
	animation = _rig.find_children("*", "AnimationPlayer", true, false)[0] as AnimationPlayer
	for zone: String in ZONE_ORDER:
		var authored := _rig.find_child(MARKERS[zone], true, false) as Node3D
		var radius := maxf(RADII[zone].x, RADII[zone].y * height_meters / 8.0)
		var hp := float(config.napeHp if zone == "Nape" else config.limbHp)
		if zone == "Head":
			hp = roundf(hp * 0.8)
		var marker := Marker3D.new()
		add_child(marker)
		marker.global_position = authored.global_position
		marker.add_to_group("grapple_zone")
		marker.set_meta("grapple_radius", radius)
		marker.set_meta("titan_id", actor_id)
		marker.set_meta("zone", zone)
		zones[zone] = {"hp": hp, "max_hp": hp, "disabled": 0.0, "radius": radius, "marker": marker, "authored": authored}
	_play("Idle")

func stagger(duration: float) -> void:
	if not is_dead() and state != "Injured" and not replicated:
		_enter("Stunned", maxf(duration, _timer if state == "Stunned" else 0.0))


func is_dead() -> bool:
	return state == "Dead"

func forward() -> Vector3:
	return Vector3(sin(rotation.y), 0.0, cos(rotation.y))

func zone_position(zone: String) -> Vector3:
	return zones[zone].marker.global_position

func grip_position() -> Vector3:
	return zone_position("RightArm") + forward() * 1.35 + Vector3.UP * 0.35

func apply_damage(zone: String, amount: float) -> Dictionary:
	var result := {"broken": false, "killed": false}
	if is_dead() or replicated or not zones.has(zone):
		return result
	var hitbox: Dictionary = zones[zone]
	hitbox.hp = maxf(0.0, float(hitbox.hp) - amount)
	if hitbox.hp > 0 or hitbox.disabled > 0:
		return result
	match zone:
		"Nape":
			_die()
			result.killed = true
			return result
		"Head":
			hitbox.disabled = config.stunnedDuration
			_enter("Stunned", hitbox.disabled)
		"LeftLeg", "RightLeg":
			hitbox.disabled = config.injuredDuration
			_enter("Injured", hitbox.disabled)
		"LeftArm", "RightArm":
			hitbox.disabled = 15.0
			_arm_scale(zone, 0.35)
			if state == "Attack" or state == "Grab":
				_enter("Stunned", 4.0)
	result.broken = true
	return result

func step(delta: float, target: Vector3, loud: bool, patrol_points: Array[Vector3]) -> void:
	if replicated:
		_step_replica(delta)
		return
	if is_dead():
		_death_age += delta
		if _death_age >= 3.2:
			removed = true
		return
	_sync_local_zones(delta)
	_timer -= delta
	_weave_age += delta
	if dummy:
		if _timer <= 0.0:
			_enter("Idle", 0.0)
		return
	var offset := target - global_position
	var flat := Vector3(offset.x, 0, offset.z)
	var distance := flat.length()
	var direction := flat.normalized() if distance > 0.001 else forward()
	var detection := float(config.detectRange) * (1.22 if loud else 1.0)
	var sees := distance <= detection and (forward().dot(direction) >= float(config.fovCos) or distance < 22.0)
	match state:
		"Idle", "Patrol":
			if sees:
				_enter("Detect", 0.65)
				cue.emit("titan_roar", global_position)
			elif state == "Idle" and _timer <= 0:
				_pick_patrol(patrol_points, 8.0)
			elif state == "Patrol":
				var route := _patrol_target - global_position
				if route.length() < 4.0 or _timer <= 0.0:
					_enter("Idle", 2.2)
				else:
					_steer(route.normalized(), float(config.walkSpeed), float(config.turnSpeed) * 0.75, delta)
		"Detect":
			_turn(direction, float(config.turnSpeed) * 1.4, delta)
			if _timer <= 0:
				_enter("Chase", 0.0)
		"Chase":
			if distance > detection * 1.45:
				_pick_patrol(patrol_points, 6.0)
				return
			var armed: bool = zones.LeftArm.disabled <= 0 or zones.RightArm.disabled <= 0
			if armed and distance <= float(config.attackRange):
				if offset.y > height_meters * 0.42 and offset.y < height_meters * 1.18:
					_enter("Grab", 1.15)
					return
				if offset.y <= height_meters * 0.75:
					_enter("Attack", 1.25)
					return
			if variant == "abnormal" and distance > 10:
				var weave := sin(_weave_age * 4.5 + position.x * 0.1) * 0.42
				direction = (direction + Vector3(-direction.z, 0, direction.x) * weave).normalized()
			var leg_scale := 0.55 if zones.LeftLeg.disabled > 0 or zones.RightLeg.disabled > 0 else 1.0
			var speed := float(config.chaseSpeed) * leg_scale
			_steer(direction, speed, float(config.turnSpeed), delta)
			_play("Run" if speed > 5.2 else "Walk")
		"Attack", "Grab":
			_step_strike(direction, delta)
		"Recover", "Stunned", "Injured":
			if _timer <= 0:
				_enter("Chase", 0.0)

func apply_snapshot(snapshot: Dictionary) -> void:
	var first := _replica.is_empty()
	_replica = snapshot
	var next := String(snapshot.aiState)
	if next == "Dead" and not is_dead():
		_die()
	state = next
	if first:
		global_position = GameData.vec(snapshot.position)
		rotation.y = float(snapshot.yaw)
	_play(snapshot.anim)
	_update_replica_zones(1.0 if first else 0.0)

func _step_replica(delta: float) -> void:
	if _replica.is_empty():
		return
	var target := GameData.vec(_replica.position)
	var weight := 1.0 - exp(-16.0 * delta)
	global_position = target if global_position.distance_to(target) > 18.0 else global_position.lerp(target, weight)
	rotation.y = lerp_angle(rotation.y, float(_replica.yaw), weight)
	velocity = GameData.vec(_replica.velocity)
	_update_replica_zones(weight)

func _update_replica_zones(weight: float) -> void:
	for zone: String in ZONE_ORDER:
		var net: Dictionary = _replica.hurtboxes[zone]
		var box: Dictionary = zones[zone]
		var disabled := float(net.disabledTimer)
		if (box.disabled > 0) != (disabled > 0):
			_arm_scale(zone, 0.35 if disabled > 0 else 1.0)
		box.hp = float(net.hp)
		box.max_hp = float(net.maxHp)
		box.disabled = disabled
		box.radius = float(net.radius)
		var marker: Node3D = box.marker
		marker.global_position = marker.global_position.lerp(GameData.vec(net.worldPos), weight)
		marker.set_meta("grapple_radius", box.radius)

func _sync_local_zones(delta: float) -> void:
	for zone: String in ZONE_ORDER:
		var box: Dictionary = zones[zone]
		var marker: Node3D = box.marker
		var authored: Node3D = box.authored
		var attachment := authored.get_parent() as BoneAttachment3D
		if attachment != null:
			attachment.on_skeleton_update()
		marker.global_position = authored.global_position
		if box.disabled > 0:
			box.disabled = maxf(0.0, float(box.disabled) - delta)
			if box.disabled == 0:
				box.hp = box.max_hp
				_arm_scale(zone, 1.0)

func _arm_scale(zone: String, amount: float) -> void:
	if zone != "LeftArm" and zone != "RightArm":
		return
	var skeleton := _rig.find_children("*", "Skeleton3D", true, false)[0] as Skeleton3D
	var bone := skeleton.find_bone("LeftLowerArm" if zone == "LeftArm" else "RightLowerArm")
	if bone >= 0:
		skeleton.set_bone_pose_scale(bone, Vector3.ONE * amount)

func _die() -> void:
	_enter("Dead", 0.0)
	for zone: String in ZONE_ORDER:
		zones[zone].marker.remove_from_group("grapple_zone")

func _enter(next: String, duration: float) -> void:
	state = next
	_timer = duration
	_hit_emitted = false
	velocity = Vector3.ZERO
	match state:
		"Idle", "Recover": _play("Idle")
		"Detect": _play("Turn")
		"Patrol": _play("Walk")
		"Attack", "Grab": _play(state, true)
		"Injured": _play("Injured")
		"Stunned": _play("Stagger")
		"Dead": _play("Death", true)

func _play(clip: String, force := false) -> void:
	if animation == null or not animation.has_animation(clip) or (_clip == clip and not force):
		return
	_clip = clip
	animation.play(clip, 0.15)

func _turn(direction: Vector3, speed: float, delta: float) -> void:
	var yaw := atan2(direction.x, direction.z)
	rotation.y = lerp_angle(rotation.y, yaw, minf(1.0, speed * delta))

func _pick_patrol(points: Array[Vector3], duration: float) -> void:
	_patrol_target = points.pick_random() if not points.is_empty() else Vector3(randf_range(-80, 80), 0, randf_range(-80, 80))
	_enter("Patrol", duration)

func _steer(direction: Vector3, speed: float, turn_speed: float, delta: float) -> void:
	var probe_origin := global_position + Vector3.UP * 2.0
	var whisker := probe_origin + direction * (height_meters * 0.45 + 3.5)
	var hit := _world_ray(probe_origin, whisker)
	if not hit.is_empty():
		var left := direction.rotated(Vector3.UP, PI * 0.5)
		var right := -left
		var offset := left if _world_ray(probe_origin, probe_origin + left * 8.0).is_empty() else right
		direction = (direction * 0.5 + offset).normalized()
	var heading := atan2(direction.x, direction.z)
	var sharp := absf(angle_difference(rotation.y, heading)) > 1.1
	_turn(direction, turn_speed, delta)
	velocity = forward() * speed * (0.35 if sharp else 1.0)
	var next := global_position + velocity * delta
	next.x = clampf(next.x, -142, 142)
	next.z = clampf(next.z, -142, 142)
	if _world_ray(probe_origin, next + Vector3.UP * 2.0).is_empty():
		global_position = next
		_foot_distance += velocity.length() * delta
		if _foot_distance >= height_meters * 0.42:
			_foot_distance = 0.0
			cue.emit("titan_step", global_position)

func _world_ray(from: Vector3, to: Vector3) -> Dictionary:
	return get_world_3d().direct_space_state.intersect_ray(PhysicsRayQueryParameters3D.create(from, to, 1))

func _step_strike(direction: Vector3, delta: float) -> void:
	var grab := state == "Grab"
	if _timer > (0.55 if grab else 0.65):
		_turn(direction, float(config.turnSpeed) * (1.1 if grab else 0.8), delta)
	if not _hit_emitted and _timer <= (0.52 if grab else 0.58):
		_hit_emitted = true
		var reach := float(config.attackRange)
		var impact := global_position + forward() * reach * (0.55 if grab else 0.65)
		impact.y += height_meters * (0.76 if grab else 0.35)
		strike.emit(self, grab, impact, reach * (0.62 if grab else 0.72), float(config.grabDamage if grab else config.attackDamage))
	if _timer <= 0:
		_enter("Recover", 1.0 if grab else 0.85)
