# ExtraMart WebP Images

New product, category, and subcategory image uploads are auto-oriented, resized
to a maximum of 1600 × 1600 pixels, and stored as WebP at quality 80. The mobile
app also requests WebP for Unsplash product and category images.

## Existing image migration

The migration covers category and subcategory images, all master-product gallery
images, and product-image snapshots in customer orders. Original files are kept
in storage; the database is changed to point to the WebP copy.

Run from the Quick Commerce backend directory with its database and storage
environment configured:

```powershell
npm run images:webp:migrate
npm run images:webp:migrate -- --execute
```

The first command is a dry run and reports supported images and sample URLs
that cannot be migrated. The second command writes WebP files and updates
references. Only this service's MinIO/local `products`, `categories`, and
`subcategories` uploads and `images.unsplash.com` URLs are handled. Other
external image hosts are left unchanged; do not treat the migration as complete
until those remaining URLs have been reviewed.
