import { Upload } from 'graphql-upload';

export default function(builder, { uploadFieldDefinitions }) {
  const relevantUploadType = attr => {
    const types = uploadFieldDefinitions.filter(
      ({ name, namespaceName, tag }) =>
        (name &&
          namespaceName &&
          attr.type.name === name &&
          attr.type.namespaceName === namespaceName) ||
        attr.tags[tag]
    );
    if (types.length === 1) {
      return types[0];
    } else if (types.length > 1) {
      throw new Error('Upload field definitions are ambiguous');
    }
  };

  builder.hook('build', (_, build) => {
    const {
      addType,
      graphql: { GraphQLScalarType, GraphQLError }
    } = build;

    const GraphQLUpload = new GraphQLScalarType({
      name: 'Upload',
      description: 'The `Upload` scalar type represents a file upload.',
      parseValue(value) {
        if (value instanceof Upload) return value.promise;
        throw new GraphQLError('Upload value invalid.');
      },
      parseLiteral(ast) {
        throw new GraphQLError('Upload literal unsupported.', ast);
      },
      serialize() {
        throw new GraphQLError('Upload serialization unsupported.');
      }
    });

    addType(GraphQLUpload);

    // override the internal types
    uploadFieldDefinitions.forEach(({ name, namespaceName, type }) => {
      if (!name || !type || !namespaceName) return; // tags or other definitions
      const theType = build.pgIntrospectionResultsByKind.type.find(
        typ => typ.name === name && typ.namespaceName === namespaceName
      );
      if (theType) {
        build.pgRegisterGqlTypeByTypeId(theType.id, () =>
          build.getTypeByName(type)
        );
      }
    });

    return _;
  });

  builder.hook('inflection', (inflection, build) => {
    return build.extend(inflection, {
      // NO ARROW FUNCTIONS HERE (this)
      uploadColumn(attr) {
        return this.column(attr) + 'Upload';
      }
    });
  });

  // GraphQLFieldConfigMap (now it inputfieldconfigmap)
  builder.hook('GraphQLInputObjectType:fields', (fields, build, context) => {
    const {
      scope: { isPgRowType, pgIntrospection: table },
      fieldWithHooks
    } = context;

    if (!isPgRowType || !table || table.kind !== 'class') {
      return fields;
    }

    return build.extend(
      fields,
      table.attributes.reduce((memo, attr) => {
        if (!build.pgColumnFilter(attr, build, context)) return memo;
        const action = context.scope.isPgBaseInput
          ? 'base'
          : context.scope.isPgPatch
          ? 'update'
          : 'create';
        if (build.pgOmit(attr, action)) return memo;
        if (attr.identity === 'a') return memo;

        if (!relevantUploadType(attr)) {
          return memo;
        }

        const fieldName = build.inflection.uploadColumn(attr);

        if (memo[fieldName]) {
          throw new Error(
            `Two columns produce the same GraphQL field name '${fieldName}' on class '${table.namespaceName}.${table.name}'; one of them is '${attr.name}'`
          );
        }
        memo = build.extend(
          memo,
          {
            [fieldName]: context.fieldWithHooks(
              fieldName,
              {
                description: attr.description,
                type: build.getTypeByName('Upload')
              },
              { pgFieldIntrospection: attr, isPgUploadField: true }
            )
          },
          `Adding field for ${build.describePgEntity(
            attr
          )}. You can rename this field with a 'Smart Comment':\n\n  ${build.sqlCommentByAddingTags(
            attr,
            {
              name: 'newNameHere'
            }
          )}`
        );
        return memo;
      }, {}),
      `Adding columns to '${build.describePgEntity(table)}'`
    );
  });

  builder.hook('GraphQLObjectType:fields:field', (field, build, context) => {
    const {
      pgIntrospectionResultsByKind: introspectionResultsByKind,
      inflection
    } = build;
    const {
      scope: { isRootMutation, fieldName, pgFieldIntrospection: table }
    } = context;

    if (!isRootMutation || !table) {
      return field;
    }

    // It's possible that `resolve` isn't specified on a field, so in that case
    // we fall back to a default resolver.
    const defaultResolver = obj => obj[fieldName];

    // Extract the old resolver from `field`
    const { resolve: oldResolve = defaultResolver, ...rest } = field; // GraphQLFieldConfig

    const tags = {};
    const types = {};
    const originals = {};

    const uploadResolversByFieldName = introspectionResultsByKind.attribute
      .filter(attr => attr.classId === table.id)
      .reduce((memo, attr) => {
        // first, try to directly match the types here
        const typeMatched = relevantUploadType(attr);
        if (typeMatched) {
          const fieldName = inflection.column(attr);
          const uploadFieldName = inflection.uploadColumn(attr);
          memo[uploadFieldName] = typeMatched.resolve;
          tags[uploadFieldName] = attr.tags;
          types[uploadFieldName] = attr.type.name;
          originals[uploadFieldName] = fieldName;
        }
        return memo;
      }, {});

    return {
      // Copy over everything except 'resolve'
      ...rest,

      // Add our new resolver which wraps the old resolver
      async resolve(source, args, context, info) {
        // Recursively check for Upload promises to resolve
        async function resolvePromises(obj) {
          for (const key of Object.keys(obj)) {
            if (obj[key] instanceof Promise) {
              if (uploadResolversByFieldName[key]) {
                const upload = await obj[key];
                // eslint-disable-next-line require-atomic-updates
                obj[originals[key]] = await uploadResolversByFieldName[key](
                  upload,
                  args,
                  context,
                  {
                    ...info,
                    uploadPlugin: { tags: tags[key], type: types[key] }
                  }
                );
              }
            } else if (obj[key] !== null && typeof obj[key] === 'object') {
              await resolvePromises(obj[key]);
            }
          }
        }
        await resolvePromises(args);
        // Call the old resolver
        const oldResolveResult = await oldResolve(source, args, context, info);
        // Finally return the result.
        return oldResolveResult;
      }
    };
  });
}
