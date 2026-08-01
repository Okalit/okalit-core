/**
 * Tagged template literal for writing GraphQL queries and mutations.
 * Compresses whitespace into a single-line string for efficient network transfer.
 *
 * Note: Interpolated values are converted to strings. Do NOT interpolate
 * user-provided input directly — use GraphQL variables instead to prevent injection.
 *
 * @param {TemplateStringsArray} strings — Template literal string parts.
 * @param {...*} values — Interpolated values.
 * @returns {string} A minified GraphQL query string.
 *
 * @example
 * const GET_USER = gql`
 *   query GetUser($id: ID!) {
 *     user(id: $id) {
 *       name
 *       email
 *     }
 *   }
 * `;
 */
export const gql = (strings, ...values) => {
    const fullQuery = strings.reduce((acc, str, i) => {
        const value = values[i];
        const parsedValue = value != null ? String(value) : '';

        return acc + str + parsedValue;
    }, '');
    
    return fullQuery.replace(/\s+/g, ' ').trim();
}