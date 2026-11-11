extends SceneTree

func _initialize() -> void:
	var combat := load("res://combat/combat.gd") as GDScript
	if combat == null or not combat.can_instantiate():
		quit(1)
		return
	var front: Dictionary = combat.damage(false, 16.0, 100.0, true, 1.0)
	var rear: Dictionary = combat.damage(false, 16.0, 100.0, true, -1.0)
	var dull: Dictionary = combat.damage(true, 500.0, 0.0, false, 0.0)
	if not front.glance or front.damage != 38 or rear.damage != 486 or not rear.critical or dull.damage != 336:
		push_error("Damage parity mismatch: %s %s %s" % [front, rear, dull])
		quit(1)
		return
	var prev := PackedVector3Array([Vector3(-1, 0, 0), Vector3(-1, 0, 2)])
	var next := PackedVector3Array([Vector3(1, 0, 0), Vector3(1, 0, 2)])
	if not combat.swept_hit(prev, next, Vector3(0, 0, 1), 0.1) or combat.swept_hit(prev, next, Vector3(0, 1, 1), 0.1):
		push_error("Continuous sword sweep mismatch")
		quit(1)
		return
	print("PASS front and rear Nape, dull blade, velocity cap and continuous sweep")
	quit()
