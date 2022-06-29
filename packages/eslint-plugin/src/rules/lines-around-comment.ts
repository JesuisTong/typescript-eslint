import {
  TSESTree,
  AST_NODE_TYPES,
  AST_TOKEN_TYPES,
} from '@typescript-eslint/utils';
import { getESLintCoreRule } from '../util/getESLintCoreRule';
import * as util from '../util';
import { isCommentToken, isTokenOnSameLine } from '../util';

const baseRule = getESLintCoreRule('lines-around-comment');

export type Options = util.InferOptionsTypeFromRule<typeof baseRule>;
export type MessageIds = util.InferMessageIdsTypeFromRule<typeof baseRule>;

/**
 * Return an array with with any line numbers that are empty.
 */
function getEmptyLineNums(lines: string[]): number[] {
  const emptyLines = lines
    .map((line, i) => ({
      code: line.trim(),
      num: i + 1,
    }))
    .filter(line => !line.code)
    .map(line => line.num);

  return emptyLines;
}

/**
 * Return an array with with any line numbers that contain comments.
 */
function getCommentLineNums(comments: TSESTree.Comment[]): number[] {
  const lines: number[] = [];

  comments.forEach(token => {
    const start = token.loc.start.line;
    const end = token.loc.end.line;

    lines.push(start, end);
  });
  return lines;
}

export default util.createRule<Options, MessageIds>({
  name: 'lines-around-comment',

  meta: {
    type: 'layout',

    docs: {
      description: 'require empty lines around comments',
      recommended: 'warn',
      extendsBaseRule: true,
    },

    fixable: 'whitespace',

    schema: baseRule.meta.schema,
    messages: baseRule.meta.messages,
  },
  defaultOptions: [{}],
  create(context) {
    const rules = baseRule.create(context);

    const options = Object.assign({}, context.options[0]);
    const ignorePattern = options.ignorePattern ?? '';
    const defaultIgnoreRegExp =
      /^\s*(?:eslint|jshint\s+|jslint\s+|istanbul\s+|globals?\s+|exported\s+|jscs)/u;
    const customIgnoreRegExp = new RegExp(ignorePattern, 'u');
    const applyDefaultIgnorePatterns =
      options.applyDefaultIgnorePatterns !== false;

    options.beforeBlockComment =
      typeof options.beforeBlockComment !== 'undefined'
        ? options.beforeBlockComment
        : true;

    const sourceCode = context.getSourceCode();

    const lines = sourceCode.lines;
    const numLines = lines.length + 1;
    const comments = sourceCode.getAllComments();
    const commentLines = getCommentLineNums(comments);
    const emptyLines = getEmptyLineNums(lines);
    const commentAndEmptyLines = new Set(commentLines.concat(emptyLines));

    /**
     * Returns whether or not comments are on lines starting with or ending with code
     */
    function codeAroundComment(token) {
      let currentToken = token;

      do {
        currentToken = sourceCode.getTokenBefore(currentToken, {
          includeComments: true,
        });
      } while (currentToken && astUtils.isCommentToken(currentToken));

      if (currentToken && astUtils.isTokenOnSameLine(currentToken, token)) {
        return true;
      }

      currentToken = token;
      do {
        currentToken = sourceCode.getTokenAfter(currentToken, {
          includeComments: true,
        });
      } while (currentToken && astUtils.isCommentToken(currentToken));

      if (currentToken && astUtils.isTokenOnSameLine(token, currentToken)) {
        return true;
      }

      return false;
    }

    /**
     * Returns whether or not comments are inside a node type or not.
     * @param {ASTNode} parent The Comment parent node.
     * @param {string} nodeType The parent type to check against.
     * @returns {boolean} True if the comment is inside nodeType.
     */
    function isParentNodeType(parent, nodeType) {
      return (
        parent.type === nodeType ||
        (parent.body && parent.body.type === nodeType) ||
        (parent.consequent && parent.consequent.type === nodeType)
      );
    }

    /**
     * Returns the parent node that contains the given token.
     * @param {token} token The token to check.
     * @returns {ASTNode|null} The parent node that contains the given token.
     */
    function getParentNodeOfToken(token) {
      const node = sourceCode.getNodeByRangeIndex(token.range[0]);

      /*
       * For the purpose of this rule, the comment token is in a `StaticBlock` node only
       * if it's inside the braces of that `StaticBlock` node.
       *
       * Example where this function returns `null`:
       *
       *   static
       *   // comment
       *   {
       *   }
       *
       * Example where this function returns `StaticBlock` node:
       *
       *   static
       *   {
       *   // comment
       *   }
       *
       */
      if (node && node.type === 'StaticBlock') {
        const openingBrace = sourceCode.getFirstToken(node, { skip: 1 }); // skip the `static` token

        return token.range[0] >= openingBrace.range[0] ? node : null;
      }

      return node;
    }

    /**
     * Returns whether or not comments are at the parent start or not.
     * @param {token} token The Comment token.
     * @param {string} nodeType The parent type to check against.
     * @returns {boolean} True if the comment is at parent start.
     */
    function isCommentAtParentStart(token, nodeType) {
      const parent = getParentNodeOfToken(token);

      if (parent && isParentNodeType(parent, nodeType)) {
        const parentStartNodeOrToken =
          parent.type === 'StaticBlock'
            ? sourceCode.getFirstToken(parent, { skip: 1 }) // opening brace of the static block
            : parent;

        return (
          token.loc.start.line - parentStartNodeOrToken.loc.start.line === 1
        );
      }

      return false;
    }

    /**
     * Returns whether or not comments are at the parent end or not.
     * @param {token} token The Comment token.
     * @param {string} nodeType The parent type to check against.
     * @returns {boolean} True if the comment is at parent end.
     */
    function isCommentAtParentEnd(token, nodeType): boolean {
      const parent = getParentNodeOfToken(token);

      return (
        !!parent &&
        isParentNodeType(parent, nodeType) &&
        parent.loc.end.line - token.loc.end.line === 1
      );
    }

    /**
     * Returns whether or not comments are at the block start or not.
     * @param {token} token The Comment token.
     * @returns {boolean} True if the comment is at block start.
     */
    function isCommentAtBlockStart(token: TSESTree.Comment): boolean {
      return (
        isCommentAtParentStart(token, 'ClassBody') ||
        isCommentAtParentStart(token, 'BlockStatement') ||
        isCommentAtParentStart(token, 'StaticBlock') ||
        isCommentAtParentStart(token, 'SwitchCase')
      );
    }

    /**
     * Returns whether or not comments are at the block end or not.
     * @param {token} token The Comment token.
     * @returns {boolean} True if the comment is at block end.
     */
    function isCommentAtBlockEnd(token) {
      return (
        isCommentAtParentEnd(token, AST_NODE_TYPES.ClassBody) ||
        isCommentAtParentEnd(token, 'BlockStatement') ||
        isCommentAtParentEnd(token, 'StaticBlock') ||
        isCommentAtParentEnd(token, 'SwitchCase') ||
        isCommentAtParentEnd(token, 'SwitchStatement')
      );
    }

    /**
     * Returns whether or not comments are at the interface start or not.
     */
    function isCommentAtInterfaceStart(token: TSESTree.Comment): boolean {
      return isCommentAtParentStart(token, AST_TOKEN_TYPES.interface);
    }

    /**
     * Returns whether or not comments are at the class end or not.
     * @param {token} token The Comment token.
     * @returns {boolean} True if the comment is at class end.
     */
    function isCommentAtClassEnd(token) {
      return isCommentAtParentEnd(token, 'ClassBody');
    }

    /**
     * Returns whether or not comments are at the object start or not.
     * @param {token} token The Comment token.
     * @returns {boolean} True if the comment is at object start.
     */
    function isCommentAtObjectStart(token: TSESTree.Comment): boolean {
      return (
        isCommentAtParentStart(token, 'ObjectExpression') ||
        isCommentAtParentStart(token, 'ObjectPattern')
      );
    }

    /**
     * Returns whether or not comments are at the object end or not.
     * @param {token} token The Comment token.
     * @returns {boolean} True if the comment is at object end.
     */
    function isCommentAtObjectEnd(token: TSESTree.Comment): boolean {
      return (
        isCommentAtParentEnd(token, 'ObjectExpression') ||
        isCommentAtParentEnd(token, 'ObjectPattern')
      );
    }

    /**
     * Returns whether or not comments are at the array start or not.
     * @param {token} token The Comment token.
     * @returns {boolean} True if the comment is at array start.
     */
    function isCommentAtArrayStart(token: TSESTree.Comment): boolean {
      return (
        isCommentAtParentStart(token, 'ArrayExpression') ||
        isCommentAtParentStart(token, 'ArrayPattern')
      );
    }

    /**
     * Returns whether or not comments are at the array end or not.
     * @param {token} token The Comment token.
     * @returns {boolean} True if the comment is at array end.
     */
    function isCommentAtArrayEnd(token: TSESTree.Comment): boolean {
      return (
        isCommentAtParentEnd(token, 'ArrayExpression') ||
        isCommentAtParentEnd(token, 'ArrayPattern')
      );
    }

    /**
     * Checks if a comment token has lines around it (ignores inline comments)
     */
    function checkForEmptyLine(
      token: TSESTree.Comment,
      opts: { after?: boolean; before?: boolean },
    ): void {
      if (applyDefaultIgnorePatterns && defaultIgnoreRegExp.test(token.value)) {
        return;
      }

      if (ignorePattern && customIgnoreRegExp.test(token.value)) {
        return;
      }

      let after = opts.after,
        before = opts.before;

      const prevLineNum = token.loc.start.line - 1,
        nextLineNum = token.loc.end.line + 1,
        commentIsNotAlone = codeAroundComment(token);

      const blockStartAllowed =
        options.allowBlockStart &&
        isCommentAtBlockStart(token) &&
        !(options.allowClassStart === false && isCommentAtClassStart(token));
      const blockEndAllowed =
        options.allowBlockEnd &&
        isCommentAtBlockEnd(token) &&
        !(options.allowClassEnd === false && isCommentAtClassEnd(token));
      const classStartAllowed =
        options.allowClassStart && isCommentAtClassStart(token);
      const classEndAllowed =
        options.allowClassEnd && isCommentAtClassEnd(token);
      const objectStartAllowed =
        options.allowObjectStart && isCommentAtObjectStart(token);
      const objectEndAllowed =
        options.allowObjectEnd && isCommentAtObjectEnd(token);
      const arrayStartAllowed =
        options.allowArrayStart && isCommentAtArrayStart(token);
      const arrayEndAllowed =
        options.allowArrayEnd && isCommentAtArrayEnd(token);

      const exceptionStartAllowed =
        blockStartAllowed ||
        classStartAllowed ||
        objectStartAllowed ||
        arrayStartAllowed;
      const exceptionEndAllowed =
        blockEndAllowed ||
        classEndAllowed ||
        objectEndAllowed ||
        arrayEndAllowed;

      // ignore top of the file and bottom of the file
      if (prevLineNum < 1) {
        before = false;
      }
      if (nextLineNum >= numLines) {
        after = false;
      }

      // we ignore all inline comments
      if (commentIsNotAlone) {
        return;
      }

      const previousTokenOrComment = sourceCode.getTokenBefore(token, {
        includeComments: true,
      });
      const nextTokenOrComment = sourceCode.getTokenAfter(token, {
        includeComments: true,
      });

      // check for newline before
      if (
        !exceptionStartAllowed &&
        before &&
        !commentAndEmptyLines.has(prevLineNum) &&
        !(
          previousTokenOrComment &&
          isCommentToken(previousTokenOrComment) &&
          isTokenOnSameLine(previousTokenOrComment, token)
        )
      ) {
        const lineStart = token.range[0] - token.loc.start.column;

        context.report({
          node: token,
          messageId: 'before',
          fix(fixer) {
            return fixer.insertTextBeforeRange([lineStart, lineStart], '\n');
          },
        });
      }

      // check for newline after
      if (
        !exceptionEndAllowed &&
        after &&
        !commentAndEmptyLines.has(nextLineNum) &&
        !(
          nextTokenOrComment &&
          isCommentToken(nextTokenOrComment) &&
          isTokenOnSameLine(token, nextTokenOrComment)
        )
      ) {
        context.report({
          node: token,
          messageId: 'after',
          fix(fixer) {
            return fixer.insertTextAfter(token, '\n');
          },
        });
      }
    }

    function checkLinesAroundComments(
      node:
        | TSESTree.TSInterfaceBody
        | TSESTree.TSTypeAliasDeclaration
        | TSESTree.TSEnumDeclaration,
    ): void {
      const scopeComments = context.getSourceCode().getCommentsInside(node);
      scopeComments.forEach(token => {
        if (token.type === AST_TOKEN_TYPES.Line) {
          if (options.beforeLineComment || options.afterLineComment) {
            checkForEmptyLine(token, {
              after: options.afterLineComment,
              before: options.beforeLineComment,
            });
          }
        } else if (token.type === AST_TOKEN_TYPES.Block) {
          if (options.beforeBlockComment || options.afterBlockComment) {
            checkForEmptyLine(token, {
              after: options.afterBlockComment,
              before: options.beforeBlockComment,
            });
          }
        }
      });
    }

    // function checkLinesAroundCommentsAfterEnum(
    //   node: TSESTree.TSEnumDeclaration,
    // ): void {
    //   const punctuator = sourceCode.getTokenAfter(node.id);
    //   if (punctuator) {
    //     checkLinesAroundComments(punctuator);
    //   }
    // }

    return {
      ...rules,
      TSEnumDeclaration: checkLinesAroundComments,
      TSInterfaceBody: checkLinesAroundComments,
      TSTypeAliasDeclaration: checkLinesAroundComments,
    };
  },
});
// https://download.cypress.io/desktop/8.3.0?platform=win32&arch=x64
