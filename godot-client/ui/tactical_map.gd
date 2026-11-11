class_name TacticalMap
extends Control

var city_layout: Dictionary
var player_position := Vector3.ZERO
var player_yaw := 0.0
var enemies: Array[Vector3] = []
var squad: Array[Vector3] = []
var pings: Array[Vector3] = []

func _draw() -> void:
	if city_layout.is_empty():
		return
	var center := size * 0.5
	var span := minf(size.x, size.y) - 30
	var scale_factor := span / 300.0
	var bounds := Rect2(center - Vector2.ONE * span / 2.0, Vector2.ONE * span)
	draw_rect(bounds, Color("142225"))
	draw_rect(bounds, Color("637a77"), false, 2.0)
	for offset in [-100, -50, 0, 50, 100]:
		var line := float(offset) * scale_factor
		draw_line(Vector2(center.x + line, bounds.position.y), Vector2(center.x + line, bounds.end.y), Color("2c4141"))
		draw_line(Vector2(bounds.position.x, center.y + line), Vector2(bounds.end.x, center.y + line), Color("2c4141"))
	for building: Dictionary in city_layout.buildings:
		var block_size := Vector2(building.width, building.depth) * scale_factor
		var block := center + Vector2(building.bx, building.bz) * scale_factor
		draw_rect(Rect2(block - block_size * 0.5, block_size), Color("57706c"))
	for depot: Array in city_layout.supplyStations:
		draw_circle(center + Vector2(depot[0], depot[2]) * scale_factor, 4.0, Color("49d8c3"))
	for enemy in enemies:
		draw_circle(center + Vector2(enemy.x, enemy.z) * scale_factor, 5.0, Color("f47a68"))
	for member in squad:
		draw_circle(center + Vector2(member.x, member.z) * scale_factor, 5.0, Color("82aef2"))
	for ping in pings:
		draw_circle(center + Vector2(ping.x, ping.z) * scale_factor, 7.0, Color("ffd793"), false, 2.0)
	var player := center + Vector2(player_position.x, player_position.z) * scale_factor
	var direction := Vector2(sin(player_yaw), cos(player_yaw))
	draw_circle(player, 5.0, Color("f3eee5"))
	draw_line(player, player + direction * 12.0, Color("f3eee5"), 2.0, true)
