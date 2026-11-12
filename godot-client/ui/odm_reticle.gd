extends Control

enum HookState { UNAVAILABLE, READY, LATCHED }

const OUTLINE := Color("10191f")
const IDLE := Color("9db2b8")
const LEFT := Color("71ecd9")
const RIGHT := Color("ffca81")

var left_state := HookState.UNAVAILABLE
var right_state := HookState.UNAVAILABLE

func update_hooks(left_ready: bool, right_ready: bool, left_latched: bool, right_latched: bool) -> void:
	var next_left := _state(left_ready, left_latched)
	var next_right := _state(right_ready, right_latched)
	if left_state == next_left and right_state == next_right:
		return
	left_state = next_left
	right_state = next_right
	queue_redraw()

func _draw() -> void:
	var center := size * 0.5
	draw_circle(center, 3.1, OUTLINE, true, -1.0, true)
	draw_circle(center, 1.35, Color("f4f3e6"), true, -1.0, true)
	_draw_hook(center, -1.0, left_state, LEFT)
	_draw_hook(center, 1.0, right_state, RIGHT)

func _draw_hook(center: Vector2, side: float, state: HookState, tint: Color) -> void:
	var tip := center + Vector2(side * 16.0, 0.0)
	var wings := PackedVector2Array([
		tip + Vector2(side * 6.0, -6.0), tip, tip + Vector2(side * 6.0, 6.0),
	])
	draw_polyline(wings, OUTLINE, 5.0, true)
	draw_polyline(wings, IDLE if state == HookState.UNAVAILABLE else tint, 2.0, true)
	if state == HookState.UNAVAILABLE:
		return
	var diamond_center := center + Vector2(side * 29.0, 0.0)
	var diamond := PackedVector2Array([
		diamond_center + Vector2(0, -5), diamond_center + Vector2(5, 0),
		diamond_center + Vector2(0, 5), diamond_center + Vector2(-5, 0),
	])
	var border := diamond.duplicate()
	border.append(diamond[0])
	draw_polyline(border, OUTLINE, 4.0, true)
	if state == HookState.LATCHED:
		draw_colored_polygon(diamond, tint)
	draw_polyline(border, tint, 1.5, true)

func _state(ready: bool, latched: bool) -> HookState:
	if latched:
		return HookState.LATCHED
	return HookState.READY if ready else HookState.UNAVAILABLE
