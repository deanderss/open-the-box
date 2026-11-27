-- Match the bucket's own per-file limit to the app's (lib/uploads.ts MAX_UPLOAD_BYTES, 25 MB), so a signed upload
-- link can't be used to store a bigger file than the app allows.
update storage.buckets set file_size_limit = 26214400 where id = 'box-videos';
