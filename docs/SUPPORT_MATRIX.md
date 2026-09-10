# ISOXML support matrix

Status terms are deliberately specific: `yes`, `partial`, `raw`, `library` (implemented but not exposed in the UI), and `no`.

| Area                           | Parsed                  | Resolved         | Validated                                          | Visualized              | User export                                               | Raw source/bytes retained          | Tested  |
| ------------------------------ | ----------------------- | ---------------- | -------------------------------------------------- | ----------------------- | --------------------------------------------------------- | ---------------------------------- | ------- |
| TASKDATA v3/v4 envelope        | yes                     | partial          | root/version partial                               | dataset summary         | no                                                        | yes                                | partial |
| TSK task                       | yes                     | core context     | references                                         | tree/inspector          | variant ZIP                                               | yes                                | yes     |
| CTR/FRM/PFD/WKR context        | yes                     | partial          | references                                         | tree/inspector          | no                                                        | yes                                | yes     |
| PFD/PLN/PNT geometry           | yes                     | partial          | coordinate bounds                                  | Leaflet                 | no                                                        | yes                                | partial |
| GRD Type 2 compact profile     | yes                     | yes              | dimensions, layout and bytes                       | viewport-cull canvas    | CSV, GeoJSON, shapefile ZIP, map PNG, variant ZIP         | yes                                | yes     |
| GRD Type 1                     | raw                     | no               | metadata/unsupported status                        | no                      | raw only                                                  | yes                                | no      |
| TZN/PDV ordering               | yes                     | yes              | layout/reference evidence                          | independent layers      | CSV, GeoJSON, shapefile ZIP, variant ZIP                  | yes                                | yes     |
| Multiple PDVs per Type 2 cell  | yes                     | yes              | yes                                                | independent layers      | CSV, GeoJSON, shapefile ZIP, variant ZIP                  | yes                                | yes     |
| Repeated DDI/different PDT     | yes                     | yes              | informational note                                 | independent layers      | CSV, GeoJSON, shapefile ZIP                               | yes                                | yes     |
| PDT/PAN                        | yes                     | partial          | references                                         | inspector               | no                                                        | yes                                | partial |
| VPN/DVP value presentation     | yes                     | yes              | scale/offset/precision                             | legend/value            | CSV, GeoJSON, shapefile ZIP                               | yes                                | yes     |
| DVC/DET/DPD/DPT                | yes                     | scoped per DVC   | references                                         | inspector/relationships | limited variant ZIP                                       | yes                                | partial |
| Time-log Type 1 XML            | yes                     | PTN/DLV/DET/DDI  | counterpart/layout/references                      | executed tree/inspector | channel CSV, GeoJSON, shapefile ZIP, map PNG, variant ZIP | yes                                | yes     |
| Time-log Type 1 BIN            | yes                     | sparse records   | indices/truncation/resource cap                    | point canvas/table      | channel CSV, GeoJSON, shapefile ZIP, map PNG              | yes                                | yes     |
| Unknown elements/attributes    | element/attribute index | n/a              | informational note                                 | raw source              | no                                                        | exact source yes                   | yes     |
| XSD schema validation          | no                      | no               | `not-checked`                                      | no                      | no                                                        | source unchanged                   | no      |
| Public DDI metadata            | bundled snapshot        | n/a              | source/version reported                            | labels/details/link     | no                                                        | n/a                                | yes     |
| Guarded package variants       | yes                     | supported subset | compatibility/risk preflight plus normal re-import | selected after creation | ZIP                                                       | source dataset retained separately | yes     |
| Byte-for-byte ISOXML re-export | n/a                     | n/a              | no                                                 | no                      | no                                                        | untouched source only              | no      |

## Authoritative inputs still required

- Official ISO 11783-10 schemas and conformance material.
- Verified grid and time-log fixtures for every additional binary profile or type.
- Manufacturer extension documentation.
- Permission before distributing any licensed standards or schema content.

The bundled DDI file is a generated snapshot of publicly available ISOBUS database metadata. It is not a substitute for the standard, and the official record linked from each known DDI remains authoritative.
