# Animation Library – Available vs Used

**Model:** `models/AnimationLibrary_Godot_Standard-transformed.glb`  
**Used in:** `player.js` (via `createPlayer`)

---

## Currently used animations

| Animation Name     | Usage in game          |
|-------------------|------------------------|
| `Idle_Loop`       | Standing still         |
| `Walk_Loop`       | Walking                |
| `Jog_Fwd_Loop`    | Running (primary)      |
| `Sprint_Loop`     | Running (fallback)     |
| `Jump_Loop`       | In-air jump (primary)  |
| `Jump_Start`      | In-air jump (fallback) |
| `Sword_Attack`    | Right-click attack     |
| `Sword_Attack_RM` | Right-click attack (fallback) |

---

## Available but unused animations

### Movement & locomotion
| Animation Name      | Duration | Notes                          |
|---------------------|----------|--------------------------------|
| `Crouch_Fwd_Loop`   | 2s       | Crouch walking                 |
| `Crouch_Idle_Loop`  | 3s       | Crouching idle                 |
| `Swim_Fwd_Loop`     | 1s       | Swimming forward               |
| `Swim_Idle_Loop`    | 3s       | Treading water                 |
| `Walk_Formal_Loop`  | 1s       | Formal/stiff walk              |
| `Push_Loop`         | 3s       | Pushing objects                |
| `Driving_Loop`      | 2s       | Driving/vehicle                |

### Combat & actions
| Animation Name      | Duration | Notes                          |
|---------------------|----------|--------------------------------|
| `Sword_Idle`        | 2s       | Idle with sword drawn          |
| `Punch_Jab`         | 1s       | Jab punch                      |
| `Punch_Cross`       | 1s       | Cross punch                    |
| `Punch_Enter`       | 1s       | Enter punch stance             |
| `Roll`              | 1s       | Dodge roll                     |
| `Roll_RM`           | 1s       | Dodge roll (alternate)         |
| `Death01`           | 2s       | Death animation                |
| `Hit_Chest`         | 0s       | Hit reaction (chest)           |
| `Hit_Head`          | 0s       | Hit reaction (head)             |

### Magic & ranged
| Animation Name         | Duration | Notes                          |
|------------------------|----------|--------------------------------|
| `Spell_Simple_Enter`   | 1s       | Enter spell casting stance     |
| `Spell_Simple_Exit`    | 0s       | Exit spell stance              |
| `Spell_Simple_Idle_Loop` | 2s    | Idle while casting             |
| `Spell_Simple_Shoot`   | 1s       | Cast spell                     |
| `Pistol_Idle_Loop`     | 2s       | Idle with pistol               |
| `Pistol_Aim_Down`      | 0s       | Aim down                       |
| `Pistol_Aim_Neutral`   | 0s       | Aim neutral                    |
| `Pistol_Aim_Up`        | 0s       | Aim up                         |
| `Pistol_Shoot`         | 1s       | Shoot pistol                   |
| `Pistol_Reload`        | 2s       | Reload pistol                  |

### Interaction & social
| Animation Name       | Duration | Notes                          |
|----------------------|----------|--------------------------------|
| `Interact`           | 2s       | Generic interact (E key)       |
| `PickUp_Table`       | 1s       | Pick up from table             |
| `Fixing_Kneeling`    | 5s       | Kneeling repair                |
| `Idle_Talking_Loop`  | 3s       | Idle while talking             |
| `Sitting_Enter`      | 1s       | Sit down                       |
| `Sitting_Exit`       | 1s       | Stand up from sitting          |
| `Sitting_Idle_Loop`  | 2s       | Sitting idle                   |
| `Sitting_Talking_Loop` | 3s     | Sitting while talking          |

### Other
| Animation Name      | Duration | Notes                          |
|---------------------|----------|--------------------------------|
| `A_TPose`           | 0s       | T-pose (reference)             |
| `Dance_Loop`        | 1s       | Dance emote                    |
| `Idle_Torch_Loop`   | 1s       | Idle holding torch             |

---

## Suggested uses for future features

| Feature idea        | Suggested animation(s)                    |
|---------------------|------------------------------------------|
| Crouch mode         | `Crouch_Idle_Loop`, `Crouch_Fwd_Loop`     |
| Swimming (water)    | `Swim_Idle_Loop`, `Swim_Fwd_Loop`         |
| Dodge roll          | `Roll` or `Roll_RM`                      |
| Death/respawn       | `Death01`                                |
| Hit feedback        | `Hit_Chest`, `Hit_Head`                  |
| Interact (E key)     | `Interact`                               |
| Magic casting       | `Spell_Simple_*`                         |
| Pistol/ranged       | `Pistol_*`                               |
| Sitting on bench    | `Sitting_Enter`, `Sitting_Idle_Loop`, `Sitting_Exit` |
| Emote / dance       | `Dance_Loop`                             |
| Sword drawn idle    | `Sword_Idle` (when weapon equipped)      |
| Push objects        | `Push_Loop`                              |

---

## How to add a new animation in `player.js`

1. Find the clip in `gltf.animations` by name.
2. Create an action: `characterMixer.clipAction(clip).setLoop(2201)` (or `2200` for one-shot).
3. Store it in `characterGroup.userData` (e.g. `ud.crouchAction`).
4. Trigger it in the `update()` function based on game state.
