# Third-party notices

The root MIT licence covers CleanFrame's original code and documentation. Third-party material retains the terms below. Keep these notices and the adjacent licence texts when sharing source or a build.

## Fonts

| Material | Terms and source record |
| --- | --- |
| Manrope | SIL Open Font License 1.1; `app/assets/manrope-OFL.txt` |
| Geist and Newsreader | SIL Open Font License 1.1; licences beside the files in `app/assets/fonts/`, with exact sources and hashes in `app/assets/fonts/SOURCES.json` |
| Optional PP Neue Montreal, PP Mori and PP Pangram Sans | Proprietary. Binaries stay in ignored `.local/` storage and are excluded from Git and public exports. The optional local overlay requires the user's own permission to use and embed those files. |

The public app uses Manrope, Geist and Newsreader. A personal widget containing proprietary fonts must stay private. See [Pangram's licensing information](https://pangrampangram.com/pages/eula).

## Icons and trademarks

| Material | Provenance and terms |
| --- | --- |
| Simple Icons service marks | CC0; exact revisions and adaptations in `app/assets/icons/SOURCES.json` and `ADDITIONAL-SOURCES.json`. The CC0 text is retained beside the icons. |
| Disney+, ABC, SBS, BBC, Channel 4, itvX and PS5 marks | [Custom Brand Icons](https://github.com/elax46/custom-brand-icons), MIT. The retained licence is `app/assets/icons/CUSTOM-BRAND-ICONS-LICENSE.txt`. ABC and SBS sources were replaced during the public-source review. Exact revisions, source files and extraction/recolour notes are in `SOURCES.json`. |
| Art, apps, settings, home and LIVE TV outlines; neutral STV monogram | Original CleanFrame drawings, covered by the project's MIT licence. |

Brand marks identify services. Their owners retain trademark rights; this project claims no endorsement or affiliation. The older Australian TV icon archive's GPL text is retained for historical provenance only; no current icon uses that archive.

## Photographs and derived materials

The fifteen photo pages were individually checked on 20 October 2026. Each displayed its credited author and free use under the [Unsplash License](https://unsplash.com/license). The [asset source register](docs/asset-sources.md) links every page. Runtime paths are in `app/assets/wallpapers/SOURCES.json`.

Photographers retain their rights. Wallpapers, thumbnails, panel backgrounds and material fields derive from the credited photographs and retain their terms. The Unsplash licence permits copying, modification and distribution subject to its restrictions, including on selling unmodified images and building a competing image service.

## HbbTV launch handoff

The installed-metadata lookup and shared-host handoff are adapted from [AeroTizen PR #1](https://github.com/helalaou/AeroTizen/pull/1), specifically commit `e65a5311b032b5af3a6bc0a6e89155770eb29552` (`launcher/js/apps.js` and `launcher/js/config.js`). Copyright (c) 2026 Hamza El Alaoui, MIT License. The full notice is bundled at `app/licenses/AeroTizen-LICENSE.txt`. AeroTizen’s watcher and native Home setup are not part of the packaged TV application.

## Separate Home-only development helper

The optional `scripts/home-button/HomeOnlyPolicy.cs` side-effect preservation approach is informed by AeroTizen's MIT-licensed `native/home-control/ControlPolicy.cs` at commit `79ba9198d63002fbfa5ad620a6abfedebd33cdc5`. Copyright (c) 2026 Hamza El Alaoui. Its full license is retained beside the helper. This separate experimental helper does not install AeroTizen's watcher or enable boot control; it requires owner-specific originals, recovery preparation and explicit native-write authorization.

## Development dependencies and exports

Development dependencies retain the licences in their npm packages. They are not copied into the TV JavaScript runtime.

`npm run export:public` excludes private fonts and includes this notice and the root MIT licence. Preserve the included font and icon licence texts. Review [public release preparation](docs/public-release.md) before publishing a repository or download.

## Owner-supplied artwork and seasonal images

The five backgrounds identified as supplied in `app/assets/wallpapers/SOURCES.json` came from the owner's `Archive.zip`. Creator and redistribution terms were not supplied. CleanFrame's MIT licence and the existing Unsplash photo terms do not grant rights to these files.
