// @codegen

// This file is run by babel so `amphtml-validator-rules` is listed in
// `devDependencies`.
// eslint-disable-next-line import/no-extraneous-dependencies
import amphtmlValidatorRules from 'amphtml-validator-rules';

const componentOverrides = {
  AmpState: true,
};

const tagNameToComponentName = tagName => (
  tagName
    .toLowerCase()
    .replace(
      /(^.|-.)/g,
      (m, p1) => p1.replace('-', '').toUpperCase(),
    )
);

const blackList = {
  '!DOCTYPE': true,
  $REFERENCE_POINT: true,
  'O:P': true,
};

const rules = amphtmlValidatorRules.amp.validator.createRules();

const DUPLICATE_SPEC_NAME = 'default';

const duplicateTags = rules.tags.reduce(
  (cache, { tagName }) => ({
    ...cache,
    [tagName]: typeof cache[tagName] === 'number' ? cache[tagName] + 1 : 0,
  }),
  {},
);

const newRules = rules.tags.reduce(
  ({ dupes, tags, ...rest }, tag) => {
    const {
      tagName,
      specName: possibleSpecName,
      extensionSpec: possibleExtensionSpec,
    } = tag;

    const extensionSpec = possibleExtensionSpec || {};
    const specName = possibleSpecName || extensionSpec.name || DUPLICATE_SPEC_NAME;

    if (blackList[tagName]) {
      return {
        dupes,
        tags,
        ...rest,
      };
    }

    if (!duplicateTags[tagName]) {
      return {
        dupes,
        tags: [...tags, tag],
        ...rest,
      };
    }

    const newTagName = `${tagName}_${Buffer.from(specName).toString('hex')}`;

    return {
      dupes: {
        ...dupes,
        [tagName]: {
          ...dupes[tagName],
          [newTagName]: specName,
        },
      },
      tags: [
        ...tags,
        {
          ...tag,
          dupeName: newTagName,
          specName,
        },
      ],
      ...rest,
    };
  },
  {
    ...rules,
    dupes: {},
    tags: [],
  },
);

const componentCode = newRules.tags.reduce(
  (
    code,
    {
      tagName,
      dupeName,
      attrs,
      requiresExtension,
    },
  ) => {
    if (blackList[tagName]) return code;

    const componentName = tagNameToComponentName(dupeName || tagName);

    const propsCode = attrs.map((
      attr => (attr > 0 ? rules.attrs[attr] : rules.internedStrings[-1 * attr])
    )).reduce(
      ({ propTypesCode, defaultPropsCode }, { name, mandatory, value }) => {
        if (!name) return { propTypesCode, defaultPropsCode };

        const newPropTypesCode = `
          ${propTypesCode}
          '${name}': PropTypes.any${mandatory ? '.isRequired' : ''},
        `;

        const newDefaultPropsCode = mandatory || !value ? (
          defaultPropsCode
        ) : (
          `
            ${defaultPropsCode}
            '${name}': '${value}',
          `
        );

        return {
          propTypesCode: newPropTypesCode,
          defaultPropsCode: newDefaultPropsCode,
        };
      },
      {
        propTypesCode: '',
        defaultPropsCode: '',
      },
    );

    const requiresExtensionContext = (
      Array.isArray(requiresExtension) ? requiresExtension : []
    ).reduce(
      (requiresExtensionContextCode, requiredExtension) => `
        ${requiresExtensionContextCode}
        contextHelper({ context, extension: '${requiredExtension}' });
      `,
      '',
    );

    const componentOverride = componentOverrides[componentName];
    if (componentOverride) {
      return `
        ${code}
        import ${componentName}Override from './components/${componentName}';
        export const ${componentName} = (props${requiresExtensionContext ? ', context' : ''}) => {
          ${requiresExtensionContext}
          return <${componentName}Override {...propsHelper(props)} />;
        };
      `;
    }

    return `
      ${code}
      const ${componentName} = (props${requiresExtensionContext ? ', context' : ''}) => {
        ${requiresExtensionContext}
        return <${tagName.toLowerCase()} {...propsHelper(props)} />;
      };

      ${propsCode.propTypesCode ? (`
        ${componentName}.propTypes = {
          ${propsCode.propTypesCode}
        };
      `) : ''}

      ${propsCode.defaultPropsCode ? (`
        ${componentName}.defaultProps = {
          ${propsCode.defaultPropsCode}
        };
      `) : ''}

      ${componentName}.contextTypes = {
        [CONTEXT_KEY]: PropTypes.shape({
          addComponent: PropTypes.func.isRequired,
        }),
      };

      export { ${componentName} };
    `;
  },
  `
    import React from 'react';
    import PropTypes from 'prop-types';
    import { CONTEXT_KEY } from '../AmpScripts';

    // React does not transform \`className\` to \`class\` on Web Components
    // like \`amp-*\`. This is mostly here as a convenience.
    // https://reactjs.org/docs/web-components.html#using-web-components-in-react
    //
    // Also, \`specName\` is only necessary for wrapping components.
    const propsHelper = (props) => {
      let newProps = Object.assign(
        {},
        props,
      );

      if (newProps.specName) {
        delete newProps.specName;
      }

      if (newProps.className){
        delete newProps.className;

        newProps = Object.assign(
          {},
          props,
          { class: props.className },
        )
      }

      return newProps;
    };

    const contextHelper = ({ context, extension }) => {
      if (typeof context === 'object' && typeof context[CONTEXT_KEY] === 'object' && typeof context[CONTEXT_KEY].addComponent === 'function') {
        context[CONTEXT_KEY].addComponent(extension);
      }
    };
  `,
);

const duplicateWrapperComponentCode = Object.entries(newRules.dupes).reduce(
  (code, [tagName, dupes]) => {
    const componentName = tagNameToComponentName(tagName);

    const dupeComponentCode = Object.entries(dupes).reduce(
      (dupeCode, [dupeTagName, specName]) => `
        ${dupeCode}
        if (props.specName === '${specName}') return <${tagNameToComponentName(dupeTagName)} {...propsHelper(props)} />;
      `,
      '',
    );

    return `
      ${code}
      const ${componentName} = (props) => {
        ${dupeComponentCode}
      };

      ${componentName}.propTypes = {
        specName: PropTypes.oneOf(${JSON.stringify(Object.values(dupes))}).isRequired,
      };

      export { ${componentName} };
    `;
  },
  '',
);

const code = `
  ${componentCode}
  ${duplicateWrapperComponentCode}
`;

// For debugging purposes.
// console.log(code.split('\n').map((line, index) => `${index + 1}${line}`).join('\n'));

module.exports = code;
