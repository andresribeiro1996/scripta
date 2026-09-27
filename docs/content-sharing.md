# Content sharing

The first implementation is mobile: tier-list and mural images, plus website links and QR codes for tier lists, murals, and tournaments.

## Button placement

| Screen | Placement |
| --- | --- |
| Tier-list editor | Visible Share icon in the top-right header, beside the existing actions. Rank remains the bottom primary action. |
| Public tier-list voting page | Visible Share icon in the top-right header. |
| Mural editor | Share in the bottom toolbar, beside Add block. |
| Mural list | Existing Share action in each mural's menu. |
| Tournament | Visible Share icon in the top-right header, beside the existing actions. |

## Share sheet

- Send link opens the device's share menu with the website URL.
- Share as image opens a clean, scrollable preview with Send image and Save image.
- Show QR displays the same website URL for scanning from another device.
- Creating or disabling a mural link remains explicit. Tier-list Open voting retains its existing confirmation and access rules.

Tier-list images include all ranked books, wrapping covers into additional rows. My ranking and Community ranking are separate choices; the current board is the default. Community images use the selected aggregation and include the vote count and capture date. Results hidden by voting rules remain hidden in export.

Mural images preserve the composition, layout, colors, and spacing without editing controls. An image can contain the current unsaved draft. An existing public link continues to show the saved mural; creating a new public link from the editor saves the draft first.

Exporting an image never publishes content or opens voting. The image preview waits for image assets to display or resolve to their existing fallback. Very large compositions retain their complete dimensions at a reduced resolution to stay within bitmap limits.

## Implementation and validation

Two Sol agents own tier-list and mural integration. A Luna agent owns the small public configuration endpoint and reviews the shared implementation. The parent integrates the native sheet, QR/image dependencies, and tournament entry point.

The backend exposes only `frontendUrl` at `GET /public-config`; outgoing arena and voting links use that configured website address. Mural links retain their existing server-generated URLs. Production `FRONTEND_URL` must point to the deployed HTTPS frontend; a development address still needs a reachable frontend server.

Validation includes shared build, mobile/backend typechecks and tests, Expo doctor, a native bundle export, and an isolated request to `/public-config`. Device visual acceptance is separate: optional emulator capture is skipped when another worktree holds the device.

## Deferred

Profile cards need an agreed public profile and a logged-out landing page. Join codes, tournament image cards, and story/square export templates are deferred. This change does not extend the web client's sharing UI or deploy a release.
