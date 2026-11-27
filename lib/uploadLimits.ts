// Upload limits shared by the submit page and the upload routes (no server imports, so the page can use it).

// The free Supabase plan's actual per-file limit is 50 MB, but a phone-recorded clip long enough to need
// anywhere near that is already well past how long a round of this game should take to watch and guess on —
// halving it to 25 MB costs nothing a real clip needs and halves the worst-case storage/egress per upload on
// a plan where both are the tightest constraint.
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_FILES_PER_SUBMIT = 5;
