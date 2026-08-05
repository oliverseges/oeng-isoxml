# Time-log support matrix

| Capability                          | Status                                  |
| ----------------------------------- | --------------------------------------- |
| XML/BIN manifest detection          | yes                                     |
| Raw bytes and XML preservation      | yes                                     |
| Counterpart validation              | yes                                     |
| Native decoder adapter registry     | yes                                     |
| Evidence-scored automatic selection | yes; unique match above threshold       |
| Manual adapter override             | yes; source remains unchanged           |
| Adapter inspector tab               | selection, source and probe evidence    |
| Background re-decoding              | yes                                     |
| Type 1 PTN/DLV declaration decoding | yes                                     |
| Type 1 record layout decoding       | yes                                     |
| Sparse/change-only values           | presence retained; no forward-fill      |
| GPS/timestamp arrays                | yes                                     |
| Independent executed DDI/DET layers | yes                                     |
| DDI code/name channel navigation    | yes; device context in row description  |
| Planned/executed navigator scope    | planned, executed or both               |
| Exact DDI channel filter            | yes                                     |
| Operation-group presets             | yes; device-class/text evidence         |
| Channel usefulness filters          | yes; value/presence/position evidence   |
| Point canvas rendering              | yes                                     |
| Point hover value cards             | value, unit, time, raw value and record |
| Described map controls              | hover, focus and accessible labels      |
| Invalid/missing-position records    | table and inspector; omitted from map   |
| Timeline/playback                   | no                                      |
| CSV export                          | yes, active executed channel            |
| GeoJSON/map-image export            | no                                      |
| Other time-log types                | raw source/bytes retained, not decoded  |

Every registered adapter probes the declaration, companion template and binary evidence. A unique high-confidence match is selected automatically. Otherwise the source stays preserved and the data panel offers compatible manual choices; the selected adapter and its evidence are stored with the dataset. The permissive PTN compatibility adapter never overrides a conflicting declaration automatically.

Executed-record inspection keeps value and position details in **Overview** and gives decoder selection its own **Adapter** tab. That tab reports the selection mode, confidence, active score, declared layout, decoded byte/record counts, source files, and every registered adapter's compatibility, automatic-selection eligibility, description and probe reason.

The Type 1 decoder follows the companion PTN template for optional position fields and treats every DLV record entry as a signed 32-bit little-endian value. Sparse channel presence is preserved exactly; the viewer does not invent forward-filled values. It reports missing counterparts, invalid DLV indices, truncated records and browser-safety limits.

The executed-data navigator can show one exact DDI across its device elements or apply an operation preset. Seeding, fertilizing, plant protection, harvesting and soil-work presets use the official DDI device-class metadata plus explicit source labels. Liming is kept separate from generic fertilizing only when the DDI, machine or device-element text identifies lime or kalk; the viewer does not infer the applied product from an otherwise generic fertilizer DDI.

The default **Useful** quality preset hides channels with no recorded values, no resolved device value presentation, only displayed zero values, no valid positioned value, or valid positioned values contained in one five-metre location cluster. Invalid/sentinel coordinates are excluded from the cluster calculation. Constant non-zero and very sparse channels remain visible by default because they may carry meaningful work-state or event evidence; both can be hidden explicitly. Every quality rule is independently switchable, **Show all** disables them, and the menu reports overlapping diagnostic counts plus the final visible-channel count. Exact-DDI and operation-preset counts are calculated after the quality filters. Missing-presentation channels retain their raw signed integers and remain inspectable through **Show all**.

Executed channel rows show both the hexadecimal DDI and its dictionary name. Map controls expose the same descriptions on pointer hover and keyboard focus. The executed outlier control uses a filter icon and reports whether activating it will hide conservative 3× IQR extremes or reveal the currently hidden values.

The navigator scope selector can isolate planned branches, executed branches, or show both. It composes with search, Issues and Spatial filters; choosing one scope also activates the first available channel from that scope when the current selection belongs elsewhere.

Moving over an executed point shows the same record card used for a clicked selection, including its displayed value, unit, timestamp and raw integer. Hover temporarily takes precedence over a clicked record; moving away restores the persistent clicked card. Screen-space hit buckets keep pointer lookup bounded to nearby rendered points rather than scanning the complete time log for every pointer event.

Large point layers are projected once into base Web Mercator coordinates. Each frame converts them with direct arithmetic, rejects off-screen points before path creation, keeps one representative for overlapping screen-density buckets, and batches the remaining points by color. Canvas storage is reused and both redraw and hover work are coalesced to animation frames. Zooming in naturally exposes denser individual records while overview maps avoid painting indistinguishable overlapping circles.
