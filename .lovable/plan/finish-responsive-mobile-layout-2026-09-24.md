# Finish responsive mobile layout

## Goal
Make ScriptScan’s redesigned interface reliable from small phones through tablets and desktop without changing capture, recognition, validation, storage, or Excel behavior.

## Changes
- Rework the shared top bar into a stable mobile grid and make the hamburger open and close the full navigation drawer consistently.
- Tighten page headings, actions, panels, and status elements so they wrap without horizontal page overflow.
- Make Capture tabs scroll or fit safely, stack upload controls, and convert each verification entry into a phone-first layout with full-width fields and actions.
- Keep desktop data tables while using compact record cards on phones for Dashboard, Results, Examinations, Reports, and examination detail screens.
- Make search/filter controls and long account, filename, matric, course, and error text shrink or wrap safely.
- Check authentication, Settings, and Help screens at phone, tablet, and desktop widths.

## Verification
- Test the hamburger and navigation destinations at 360px phone width.
- Inspect Capture, Dashboard, Results, Examinations, Reports, Settings, Help, and sign-in at phone and desktop widths.
- Confirm there is no horizontal document overflow and review the latest build/runtime diagnostics.

## Technical details
- Preserve the existing TanStack routes and all data/OCR/export handlers.
- Use the existing responsive card/table split and design-system controls.
- Limit edits to shared shell and presentation classes/markup.
