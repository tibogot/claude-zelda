# UA1+UA2_compressed.glb — Bones & Animations Reference

Reference for the character model used in **parkourtsushima** (`player-parkourtsushima.js`). Use this when adding animations or attaching objects (sword, hat, etc.) to specific bones.

---

## Bones (nodes)

| Index | Name | Notes |
|------:|------|--------|
| 0 | Head | Head bone (hat attachment) |
| 1 | neck_01 | Neck |
| 2 | index_04_leaf_l | Left index finger |
| 3 | index_03_l | |
| 4 | index_02_l | |
| 5 | index_01_l | |
| 6 | middle_04_leaf_l | Left middle finger |
| 7 | middle_03_l | |
| 8 | middle_02_l | |
| 9 | middle_01_l | |
| 10 | pinky_04_leaf_l | Left pinky |
| 11 | pinky_03_l | |
| 12 | pinky_02_l | |
| 13 | pinky_01_l | |
| 14 | ring_04_leaf_l | Left ring finger |
| 15 | ring_03_l | |
| 16 | ring_02_l | |
| 17 | ring_01_l | |
| 18 | thumb_04_leaf_l | Left thumb |
| 19 | thumb_03_l | |
| 20 | thumb_02_l | |
| 21 | thumb_01_l | |
| 22 | **hand_l** | Left hand (e.g. shield) |
| 23 | lowerarm_l | |
| 24 | upperarm_l | |
| 25 | clavicle_l | |
| 26 | index_04_leaf_r | Right index finger |
| 27 | index_03_r | |
| 28 | index_02_r | |
| 29 | index_01_r | |
| 30 | middle_04_leaf_r | Right middle finger |
| 31 | middle_03_r | |
| 32 | middle_02_r | |
| 33 | middle_01_r | |
| 34 | pinky_04_leaf_r | Right pinky |
| 35 | pinky_03_r | |
| 36 | pinky_02_r | |
| 37 | pinky_01_r | |
| 38 | ring_04_leaf_r | Right ring finger |
| 39 | ring_03_r | |
| 40 | ring_02_r | |
| 41 | ring_01_r | |
| 42 | thumb_04_leaf_r | Right thumb |
| 43 | thumb_03_r | |
| 44 | thumb_02_r | |
| 45 | thumb_01_r | |
| 46 | **hand_r** | Right hand (sword attachment) |
| 47 | lowerarm_r | |
| 48 | upperarm_r | |
| 49 | clavicle_r | |
| 50 | spine_03 | |
| 51 | spine_02 | |
| 52 | spine_01 | |
| 53 | ball_leaf_l | Left foot ball |
| 54 | ball_l | |
| 55 | **foot_l** | Left foot (footstep sync) |
| 56 | calf_l | |
| 57 | thigh_l | |
| 58 | ball_leaf_r | Right foot ball |
| 59 | ball_r | |
| 60 | **foot_r** | Right foot (footstep sync) |
| 61 | calf_r | |
| 62 | thigh_r | |
| 63 | pelvis | |
| 64 | root | Root bone |
| 65 | Mannequin | |
| 66 | Armature | |

**Used in player:** `hand_r`, `hand_l`, `Head`, `foot_l`, `foot_r`.

---

## Animations

Clips use the `_Armature` suffix (e.g. `Idle_Loop_Armature`). Below: index and name.

| # | Name |
|---|------|
| 0 | A_TPose |
| 1 | A_TPose_Armature.001 |
| 2 | Chest_Open |
| 3 | ClimbUp_1m_RM |
| 4 | Consume |
| 5 | **Crouch_Fwd_Loop_Armature** |
| 6 | **Crouch_Idle_Loop_Armature** |
| 7 | Dance_Loop_Armature |
| 8 | Death01_Armature |
| 9 | Driving_Loop_Armature |
| 10 | Farm_Harvest |
| 11 | Farm_PlantSeed |
| 12 | Farm_Watering |
| 13 | Fixing_Kneeling_Armature |
| 14 | Hit_Chest_Armature |
| 15 | Hit_Head_Armature |
| 16 | Hit_Knockback |
| 17 | Hit_Knockback_RM |
| 18 | Idle_FoldArms_Loop |
| 19 | Idle_Lantern_Loop |
| 20 | **Idle_Loop_Armature** |
| 21 | Idle_No_Loop |
| 22 | Idle_Rail_Call |
| 23 | Idle_Rail_Loop |
| 24 | Idle_Shield_Break |
| 25 | Idle_Shield_Loop |
| 26 | Idle_Talking_Loop_Armature |
| 27 | Idle_TalkingPhone_Loop |
| 28 | Idle_Torch_Loop_Armature |
| 29 | Interact_Armature |
| 30 | **Jog_Fwd_Loop_Armature** |
| 31 | Jump_Land_Armature |
| 32 | **Jump_Loop_Armature** |
| 33 | **Jump_Start_Armature** |
| 34 | LayToIdle |
| 35 | Melee_Hook |
| 36 | Melee_Hook_Rec |
| 37 | NinjaJump_Idle_Loop |
| 38 | NinjaJump_Land |
| 39 | NinjaJump_Start |
| 40 | OverhandThrow |
| 41 | PickUp_Table_Armature |
| 42 | Pistol_Aim_Down_Armature |
| 43 | Pistol_Aim_Neutral_Armature |
| 44 | Pistol_Aim_Up_Armature |
| 45 | Pistol_Idle_Loop_Armature |
| 46 | Pistol_Reload_Armature |
| 47 | Pistol_Shoot_Armature |
| 48 | Punch_Cross_Armature |
| 49 | Punch_Jab_Armature |
| 50 | Push_Loop_Armature |
| 51 | **Roll_Armature** |
| 52 | **Roll_RM_Armature** |
| 53 | Shield_Dash_RM |
| 54 | Shield_OneShot |
| 55 | Sitting_Enter_Armature |
| 56 | Sitting_Exit_Armature |
| 57 | Sitting_Idle_Loop_Armature |
| 58 | Sitting_Talking_Loop_Armature |
| 59 | Slide_Exit |
| 60 | Slide_Loop |
| 61 | Slide_Start |
| 62 | Spell_Simple_Enter_Armature |
| 63 | Spell_Simple_Exit_Armature |
| 64 | Spell_Simple_Idle_Loop_Armature |
| 65 | Spell_Simple_Shoot_Armature |
| 66 | **Sprint_Loop_Armature** |
| 67 | Swim_Fwd_Loop_Armature |
| 68 | Swim_Idle_Loop_Armature |
| 69 | **Sword_Attack_Armature** |
| 70 | **Sword_Attack_RM_Armature** |
| 71 | Sword_Block |
| 72 | Sword_Dash_RM |
| 73 | Sword_Idle_Armature |
| 74 | Sword_Regular_A |
| 75 | Sword_Regular_A_Rec |
| 76 | Sword_Regular_B |
| 77 | Sword_Regular_B_Rec |
| 78 | Sword_Regular_C |
| 79 | Sword_Regular_Combo |
| 80 | TreeChopping_Loop |
| 81 | Walk_Carry_Loop |
| 82 | Walk_Formal_Loop_Armature |
| 83 | **Walk_Loop_Armature** |
| 84 | Yes |
| 85 | Zombie_Idle_Loop |
| 86 | Zombie_Scratch |
| 87 | Zombie_Walk_Fwd_Loop |

**Used in player (movement state machine):** Idle_Loop_Armature, Walk_Loop_Armature, Sprint_Loop_Armature, Jog_Fwd_Loop_Armature, Jump_Loop_Armature, Jump_Start_Armature, Sword_Attack_Armature, Sword_Attack_RM_Armature, Crouch_Idle_Loop_Armature, Crouch_Fwd_Loop_Armature, Roll_Armature, Roll_RM_Armature.

---

*Generated from `models/UA1+UA2_compressed.glb`. To refresh this list, run the GLB inspector (e.g. the Node one-liner that parses the JSON chunk) or check the browser console when loading parkourtsushima (logs under `[UA1+UA2_compressed]`).*
