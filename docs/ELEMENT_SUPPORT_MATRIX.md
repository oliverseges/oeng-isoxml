# Element support matrix

| Element                    | Raw parsed | Typed                      | References               | Validation                   | UI                  |
| -------------------------- | ---------- | -------------------------- | ------------------------ | ---------------------------- | ------------------- |
| `ISO11783_TaskData`        | yes        | version metadata           | n/a                      | root/version partial         | dataset summary     |
| `TSK`                      | yes        | yes                        | CTR/FRM/PFD/WKR          | duplicate/broken             | task tree/inspector |
| `CTR`, `FRM`, `PFD`, `WKR` | yes        | summary                    | partial                  | duplicate/broken             | task context        |
| `PLN`, `LSG`, `PNT`        | yes        | boundary points            | parent/child             | coordinate bounds            | Leaflet boundary    |
| `GRD`                      | yes        | compact Type 2             | file/TZN                 | dimensions/coordinates/bytes | canvas/table        |
| `TZN`, `PDV`               | yes        | ordered channels           | PDT/DET/VPN/PAN          | ambiguity/missing refs       | tree/inspector      |
| `PDT`, `PAN`               | yes        | partial                    | product/DET              | broken refs                  | relationships       |
| `VPN`, `DVP`               | yes        | offset/scale/decimals/unit | PDV/DPD                  | invalid scale                | value evidence      |
| `DVC`, `DET`               | yes        | partial                    | parent/PDV               | duplicate/broken             | tree/relationships  |
| `DPD`, `DPT`               | yes        | raw                        | partial                  | broken refs                  | raw/relationships   |
| `TLG`                      | yes        | raw                        | file counterpart partial | adapter status               | manifest            |
| unknown/OEM                | indexed    | no                         | raw only                 | viewer-support info          | raw source          |

Unknown attributes remain on every raw object even where typed decoding exists.

“Raw parsed” describes the element/attribute index, not a full XML concrete-syntax tree. The exact XML string is retained separately.
