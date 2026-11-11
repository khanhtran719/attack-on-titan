extends SkeletonModifier3D
## Procedural source overlays: locomotion banking, grapple-side arm aim and cape flutter.

var yaw: float = PI
var feet := Vector3.ZERO
var speed: float = 0.0
var vertical_speed: float = 0.0
var lateral_accel: float = 0.0
var grounded: bool = false
var animation: StringName = &"Idle"
var left_anchor: Variant = null
var right_anchor: Variant = null
var _bank: float = 0.0
var _pitch: float = 0.0
var _wind_time: float = 0.0
var _bones: Dictionary = {}


func _ready() -> void:
	var skeleton := get_skeleton()
	for bone_name: String in ["Spine1", "LeftShoulder", "RightShoulder", "CapeTop", "CapeMid", "CapeTip"]:
		_bones[bone_name] = skeleton.find_bone(bone_name)


func _process_modification_with_delta(delta: float) -> void:
	if _bones.is_empty():
		return
	var skeleton := get_skeleton()
	var smoothing := 1.0 - exp(-10.0 * delta)
	var desired_roll := clampf(-lateral_accel * 0.032, -0.52, 0.52)
	var desired_pitch := clampf(speed * 0.008, 0.0, 0.18) if grounded else clampf(speed * 0.012 - vertical_speed * 0.01, -0.35, 0.55)
	_bank = lerpf(_bank, desired_roll, smoothing)
	_pitch = lerpf(_pitch, desired_pitch, smoothing)

	if animation != &"Death":
		var spine := int(_bones.Spine1)
		if spine >= 0:
			var euler := Basis(skeleton.get_bone_pose_rotation(spine)).get_euler(EULER_ORDER_XYZ)
			euler.x = _pitch * 0.35
			euler.z = _bank * 0.45
			skeleton.set_bone_pose_rotation(spine, Basis.from_euler(euler, EULER_ORDER_XYZ).get_rotation_quaternion())
		if animation != &"LightAttack" and animation != &"HeavyAttack":
			_aim_arm(skeleton, int(_bones.LeftShoulder), left_anchor, -1.0)
			_aim_arm(skeleton, int(_bones.RightShoulder), right_anchor, 1.0)

	_wind_time += delta * 12.0
	var wind := clampf(speed / 28.0, 0.05, 1.0)
	_set_x(skeleton, int(_bones.CapeTop), clampf(wind * 0.25, 0.0, 0.28))
	_set_x(skeleton, int(_bones.CapeMid), 0.06 + wind * 0.18 + sin(_wind_time) * 0.08 * wind)
	_set_x(skeleton, int(_bones.CapeTip), 0.04 + wind * 0.15 + cos(_wind_time * 1.3) * 0.10 * wind)


func _aim_arm(skeleton: Skeleton3D, bone: int, anchor: Variant, side: float) -> void:
	if bone < 0 or not anchor is Vector3:
		return
	var offset: Vector3 = anchor - feet - Vector3.UP * 1.25
	if offset.length_squared() < 0.01:
		return
	var direction := offset.normalized()
	var local_x := direction.x * cos(-yaw) - direction.z * sin(-yaw)
	var local_z := direction.x * sin(-yaw) + direction.z * cos(-yaw)
	var euler := Vector3(
		clampf(-direction.y * 0.55, -0.7, 0.5),
		clampf(local_x * 0.45, -0.5, 0.5),
		side * clampf(absf(local_z) * 0.25, 0.0, 0.4)
	)
	skeleton.set_bone_pose_rotation(bone, Basis.from_euler(euler, EULER_ORDER_XYZ).get_rotation_quaternion())


func _set_x(skeleton: Skeleton3D, bone: int, rotation_x: float) -> void:
	if bone >= 0:
		var euler := Basis(skeleton.get_bone_pose_rotation(bone)).get_euler(EULER_ORDER_XYZ)
		euler.x = rotation_x
		skeleton.set_bone_pose_rotation(bone, Basis.from_euler(euler, EULER_ORDER_XYZ).get_rotation_quaternion())
