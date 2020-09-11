# postgraphile-derived-upload-field

Thanks to https://github.com/graphile-contrib/postgraphile-plugin-upload-field for the amazing plugin!

This plugin is a modification of the upload field plugin in that this creates a derived field, which allows you to either upload or patch the original type.

## Postgres

This plugin requires some modifications to your schema. You can author your schemas with custom domains like `image`, `attachment`, or `upload`, or even just add `@upload` into your comments to create upload fields:

```sql
create table public.post (
  id serial primary key,
  header text,
  body text,
  icon text,
  image image,
  attachment attachment,
  upload upload
);

comment on column public.post.icon is E'@upload';
```

If you want to see the types, checkout https://github.com/pyramation/pg-utils/blob/master/packages/types/sql/types--0.0.1.sql

## Graphile Settings

Register your types, tags, and your resolve function for uploading files:

```js
    graphileBuildOptions: {
      uploadFieldDefinitions: [
        {
          name: 'upload',
          namespaceName: 'public',
          type: 'String',
          resolve: resolveUpload
        },
        {
          name: 'attachment',
          namespaceName: 'public',
          type: 'JSON',
          resolve: resolveUpload
        },
        {
          name: 'image',
          namespaceName: 'public',
          type: 'JSON',
          resolve: resolveUpload
        },
        {
          tag: 'upload',
          resolve: resolveUpload
        }
      ],
```

## Examples 

To see a resolver in action, checkout the original plugin example here https://github.com/graphile-contrib/postgraphile-upload-example 