export default {
  rules: {
    'no-comments': {
      meta: {
        type: 'suggestion',
        schema: [],
        messages: { forbidden: 'Use a clearer name or a unit test instead of a code comment.' },
      },
      create(context) {
        return {
          Program() {
            for (const token of context.sourceCode.getAllComments()) {
              if (token.type === 'Line' || token.type === 'Block') {
                context.report({ loc: token.loc, messageId: 'forbidden' });
              }
            }
          },
        };
      },
    },
  },
};
