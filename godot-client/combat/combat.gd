class_name TitanCombat
extends Node3D

signal hit(actor: TitanActor, zone: String, outcome: Dictionary)
signal effect(kind: String, point: Vector3)

const GameData := preload("res://resources/game_data.gd")
const Titan := preload("res://combat/titan.gd")

var locked: TitanActor
var zone := "Nape"
var combo := 0
var hit_stop := 0.0
var _combo_time := 0.0
var _cooldown := 0.0
var _spear_cooldown := 0.0
var _attack_age := 0.0
var _duration := 0.0
var _heavy := false
var _previous: Array[PackedVector3Array] = []
var _hit_zones: Dictionary = {}
var _hit_counts: Dictionary = {}
var _projectiles: Array[Dictionary] = []
var projectile_visual: Callable
var config: Dictionary

func _ready() -> void:
	config = GameData.get_data().config.combat

func reset() -> void:
	locked = null
	zone = "Nape"
	combo = 0
	hit_stop = 0.0
	_combo_time = 0.0
	_cooldown = 0.0
	_spear_cooldown = 0.0
	_duration = 0.0
	_previous.clear()
	for projectile in _projectiles:
		projectile.node.queue_free()
	_projectiles.clear()

func has_target() -> bool:
	return is_instance_valid(locked) and not locked.is_dead()

func target_position() -> Vector3:
	return locked.zone_position(zone) if has_target() else Vector3.ZERO

func cycle_target(feet: Vector3, forward: Vector3, titans: Array[TitanActor]) -> void:
	var choices := titans.filter(func(actor: TitanActor) -> bool: return not actor.is_dead())
	if choices.is_empty():
		locked = null
		return
	choices.sort_custom(func(a: TitanActor, b: TitanActor) -> bool:
		var offset_a := a.global_position - feet
		var offset_b := b.global_position - feet
		return offset_a.length() - offset_a.normalized().dot(forward) * 25.0 < offset_b.length() - offset_b.normalized().dot(forward) * 25.0)
	var index := choices.find(locked) if has_target() else -1
	locked = choices[(index + 1) % choices.size()]
	zone = "Nape"

func cycle_zone(direction: int) -> void:
	zone = Titan.ZONE_ORDER[posmod(Titan.ZONE_ORDER.find(zone) + direction, Titan.ZONE_ORDER.size())]

func start_attack(heavy: bool, feet: Vector3, velocity: Vector3, titans: Array[TitanActor]) -> Dictionary:
	if _duration > 0.0 or _cooldown > 0.0:
		return {}
	_heavy = heavy
	_attack_age = 0.0
	_duration = config.heavyAttackDuration if heavy else config.lightAttackDuration
	_hit_zones.clear()
	_hit_counts.clear()
	_previous.clear()
	var best_distance := 9.0
	var lunge := Vector3.ZERO
	if has_target() and feet.distance_to(target_position()) <= 9.5:
		lunge = target_position() - feet
	else:
		for actor in titans:
			if actor.is_dead():
				continue
			for candidate: String in Titan.ZONE_ORDER:
				var offset := actor.zone_position(candidate) - feet
				if offset.length() < best_distance:
					best_distance = offset.length()
					lunge = offset
	lunge = lunge.normalized() * maxf(18.0, velocity.length()) * 0.38 if lunge.length() > 0.5 and lunge.length() <= 8.8 else Vector3.ZERO
	return {"duration": _duration, "lunge": lunge}

func step(delta: float, feet: Vector3, velocity: Vector3, durability: float,
		blades: Array[PackedVector3Array], titans: Array[TitanActor], authoritative: bool) -> void:
	_cooldown = maxf(0.0, _cooldown - delta)
	_spear_cooldown = maxf(0.0, _spear_cooldown - delta)
	_combo_time = maxf(0.0, _combo_time - delta)
	hit_stop = maxf(0.0, hit_stop - delta)
	if _combo_time <= 0.0:
		combo = 0
	_step_projectiles(delta, titans)
	if _duration <= 0.0:
		return
	_attack_age += delta
	if _attack_age >= _duration:
		_duration = 0.0
		_cooldown = config.attackCooldown
		return
	var segments: Array[PackedVector3Array] = []
	for blade in blades:
		segments.append(PackedVector3Array([blade[0], blade[0] + (blade[1] - blade[0]).normalized() * float(config.bladeReach)]))
	var progress := _attack_age / _duration
	if authoritative and progress >= float(config.attackActiveStartNorm) and progress <= float(config.attackActiveEndNorm):
		_resolve_attack(feet, velocity, durability, segments, titans)
	_previous = segments

func _resolve_attack(feet: Vector3, velocity: Vector3, durability: float, blades: Array[PackedVector3Array],
		titans: Array[TitanActor]) -> void:
	var zones: Array = ["Nape"]
	if zone != "Nape":
		zones.append(zone)
	for candidate: String in Titan.ZONE_ORDER:
		if candidate not in zones:
			zones.append(candidate)
	for actor in titans:
		if actor.is_dead():
			continue
		for candidate: String in zones:
			var hits := int(_hit_counts.get(actor.actor_id, 0))
			if hits >= (2 if _heavy else 1) or actor.is_dead():
				break
			var key := "%s:%s" % [actor.actor_id, candidate]
			if _hit_zones.has(key):
				continue
			var point := actor.zone_position(candidate)
			var radius := float(actor.zones[candidate].radius)
			var intersects := (feet + Vector3.UP * 1.15).distance_to(point) <= radius + float(config.bladeReach) * 0.95
			for index in blades.size():
				var prior := _previous[index] if index < _previous.size() else blades[index]
				intersects = intersects or swept_hit(prior, blades[index], point, radius)
			if not intersects:
				continue
			_hit_zones[key] = true
			_hit_counts[actor.actor_id] = hits + 1
			var approach := feet - actor.global_position
			approach.y = 0.0
			var approach_cos := approach.normalized().dot(actor.forward()) if approach.length_squared() > 0.00001 else -1.0
			var outcome := damage(_heavy, (velocity - actor.velocity).length(), durability, candidate == "Nape", approach_cos)
			outcome.merge({"killed": false, "broken": false, "spear": false, "point": point})
			if not outcome.glance:
				outcome.merge(actor.apply_damage(candidate, outcome.damage), true)
				_add_combo()
				hit_stop = config.hitStopDuration
			hit.emit(actor, candidate, outcome)

func launch_spear(origin: Vector3, aim: Vector3, titans: Array[TitanActor], local: bool) -> bool:
	if _spear_cooldown > 0.0:
		return false
	_spear_cooldown = config.thunderSpearCooldown
	if not local:
		return true
	var target := _spear_aim(origin, aim, titans)
	var direction: Vector3 = (target.point - origin).normalized()
	var visual: Node3D = projectile_visual.call() if projectile_visual.is_valid() else Node3D.new()
	add_child(visual)
	visual.global_position = origin
	visual.look_at(origin + direction, Vector3.FORWARD if absf(direction.y) > 0.98 else Vector3.UP, true)
	_projectiles.append({"node": visual, "direction": direction, "remaining": origin.distance_to(target.point),
		"actor": target.actor, "zone": target.zone})
	return true

func _spear_aim(origin: Vector3, aim: Vector3, titans: Array[TitanActor]) -> Dictionary:
	var range_limit := float(config.thunderSpearRange)
	var obstruction := _ray(origin, origin + aim * range_limit)
	var range_clear := range_limit if obstruction.is_empty() else origin.distance_to(obstruction.position)
	var chosen := {"point": origin + aim * minf(range_clear, 45.0), "actor": null, "zone": "Nape"}
	if not obstruction.is_empty():
		chosen.point = obstruction.position
	var best_score := INF
	for actor in titans:
		if actor.is_dead():
			continue
		for candidate: String in Titan.ZONE_ORDER:
			var point := actor.zone_position(candidate)
			var offset := point - origin
			var along := offset.dot(aim)
			var radial := (offset - aim * along).length()
			if along < 0.0 or along > range_clear or radial > float(actor.zones[candidate].radius) * 3.4:
				continue
			if not _ray(origin, point).is_empty():
				continue
			var score := radial * 3.0 + offset.length() * 0.15 - (2.5 if candidate == "Nape" else 0.0)
			if actor == locked and candidate == zone:
				score -= 100.0
			if score < best_score:
				best_score = score
				chosen = {"point": point, "actor": actor, "zone": candidate}
	return chosen

func _step_projectiles(delta: float, titans: Array[TitanActor]) -> void:
	for index in range(_projectiles.size() - 1, -1, -1):
		var shot := _projectiles[index]
		var visual: Node3D = shot.node
		var distance := minf(float(config.thunderSpearSpeed) * delta, float(shot.remaining))
		var next := visual.global_position + Vector3(shot.direction) * distance
		var wall := _ray(visual.global_position, next)
		if not wall.is_empty():
			next = wall.position
			shot.actor = null
		visual.global_position = next
		shot.remaining -= distance
		if shot.remaining <= 0.001 or not wall.is_empty():
			_detonate(next, shot.actor if is_instance_valid(shot.actor) else null, shot.zone, titans)
			visual.queue_free()
			_projectiles.remove_at(index)

func _detonate(point: Vector3, direct: TitanActor, direct_zone: String, titans: Array[TitanActor]) -> void:
	effect.emit("explosion", point)
	for actor in titans:
		if actor.is_dead():
			continue
		var impacted := false
		var order: Array = Titan.ZONE_ORDER.duplicate()
		if direct == actor:
			order.erase(direct_zone)
			order.push_front(direct_zone)
		for candidate: String in order:
			if actor.is_dead():
				break
			var target := actor.zone_position(candidate)
			var distance := point.distance_to(target)
			var primary := direct == actor and candidate == direct_zone
			if candidate == "Nape" and not primary and (direct == actor or distance > 1.8):
				continue
			if not primary and distance > float(config.thunderSpearBlastRadius) + float(actor.zones[candidate].radius):
				continue
			var amount: float = config.thunderSpearBaseDamage if primary else config.thunderSpearSplashDamage
			var outcome := actor.apply_damage(candidate, amount)
			outcome.merge({"damage": amount, "multiplier": 2.0, "critical": candidate == "Nape", "glance": false, "spear": true, "point": target})
			impacted = true
			_add_combo()
			hit.emit(actor, candidate, outcome)
		if impacted:
			actor.stagger(3.5)

func _ray(origin: Vector3, end: Vector3) -> Dictionary:
	return get_world_3d().direct_space_state.intersect_ray(PhysicsRayQueryParameters3D.create(origin, end, 1))

func _add_combo() -> void:
	combo += 1
	_combo_time = config.comboResetTime

static func damage(heavy: bool, speed: float, durability: float, nape: bool, approach: float) -> Dictionary:
	var rules: Dictionary = GameData.get_data().config.combat
	var base := float(rules.baseHeavyDamage if heavy else rules.baseLightDamage)
	var multiplier := clampf(float(rules.minVelocityMultiplier) + speed / float(rules.velocityReferenceSpeed),
		float(rules.minVelocityMultiplier), float(rules.maxVelocityMultiplier))
	var sharpness := 1.0 if durability > 0 else float(rules.dullBladeMultiplier)
	var glance := nape and approach > float(rules.napeCriticalAngleCos)
	var bonus := (float(rules.napeRearBonusMultiplier) if approach < -0.55 else 1.25) if nape else 1.0
	var amount := base * 0.2 * sharpness if glance else base * multiplier * sharpness * bonus
	return {"damage": roundi(amount), "multiplier": multiplier, "critical": nape and not glance, "glance": glance}

static func swept_hit(previous: PackedVector3Array, current: PackedVector3Array, center: Vector3, radius: float) -> bool:
	for slice in 5:
		var alpha := float(slice) / 4.0
		var hilt := previous[0].lerp(current[0], alpha)
		var tip := previous[1].lerp(current[1], alpha)
		if Geometry3D.get_closest_point_to_segment(center, hilt, tip).distance_squared_to(center) <= radius * radius:
			return true
	return false
