extends SceneTree

func _initialize() -> void:
	call_deferred("run")

func run() -> void:
	var script := load("res://combat/titan.gd") as GDScript
	if script == null:
		quit(1)
		return
	var titan: Node3D = script.new()
	titan.configure("titan-test", "normal", 8.0, false)
	root.add_child(titan)
	var target := Vector3(0, 0, 5)
	var waypoints: Array[Vector3] = [Vector3(0, 0, 5)]
	var impacts: Array = []
	titan.strike.connect(func(actor: Node3D, grab: bool, point: Vector3, radius: float, damage: float) -> void:
		impacts.append([actor, grab, point, radius, damage]))
	for tick in 180:
		titan.step(1.0 / 60.0, target, false, waypoints)
	var leg: Dictionary = titan.apply_damage("LeftLeg", 500.0)
	var killed: Dictionary = titan.apply_damage("Nape", 500.0)
	if titan.zones.size() != 6 or titan.zones.Nape.marker == null or impacts.is_empty() or not leg.broken or not killed.killed or not titan.is_dead():
		push_error("Titan failed hitbox, AI impact, injury or death checks")
		quit(1)
		return
	print("PASS Titan zones, AI melee, leg disable and Nape death")
	quit()
