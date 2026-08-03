# Validation rule catalogue

| Code                                   | Severity | Category  | Recovery                                 |
| -------------------------------------- | -------- | --------- | ---------------------------------------- |
| `PACKAGE_DUPLICATE_FILE`               | warning  | package   | every occurrence listed; first path used |
| `PACKAGE_MULTIPLE_TASKDATA`            | error    | package   | first document selected, all retained    |
| `PACKAGE_UNCONVENTIONAL_TASKDATA_NAME` | warning  | package   | root detected from content               |
| `PACKAGE_UNUSED_FILE`                  | info     | package   | file remains inspectable                 |
| `XML_MALFORMED_OR_UNSAFE`              | error    | XML       | non-primary documents may be skipped     |
| `XML_INVALID_ROOT`                     | error    | XML       | raw tree remains visible                 |
| `REF_DUPLICATE_ID`                     | error    | reference | no candidate selected                    |
| `REF_BROKEN`                           | warning  | reference | raw reference retained                   |
| `GRID_INVALID_DIMENSIONS`              | error    | grid      | no complete spatial decode               |
| `GRID_CELL_LIMIT_EXCEEDED`             | error    | grid      | raw source/bytes retained                |
| `GRID_INVALID_COORDINATES`             | error    | spatial   | values remain available                  |
| `GRID_TYPE_PARTIAL_SUPPORT`            | warning  | support   | raw object and bytes retained            |
| `GRID_LAYOUT_AMBIGUOUS`                | error    | grid      | decoder refuses to guess                 |
| `GRID_BINARY_MISSING`                  | error    | grid      | GRD metadata remains visible             |
| `GRID_BINARY_TRUNCATED`                | error    | grid      | complete records decoded                 |
| `GRID_BINARY_TRAILING_BYTES`           | warning  | grid      | expected records decoded                 |
| `GRID_DECLARED_LENGTH_MISMATCH`        | warning  | grid      | actual bytes remain authoritative        |
| `MULTIPLE_PDV_SAME_DDI`                | info     | semantic  | independent channel identities           |
| `PDV_MISSING_VALUE_PRESENTATION`       | warning  | semantic  | raw value and identity retained          |
| `VALUE_PRESENTATION_INVALID`           | error    | semantic  | raw value retained                       |
| `TIMELOG_DECODER_ADAPTER_REQUIRED`     | info     | support   | source files retained                    |
| `VIEWER_UNKNOWN_ELEMENT`               | info     | support   | exact raw source retained                |

Every issue also records source, explanation, suggested action, whether recovery occurred and whether displayed results may be incomplete.
