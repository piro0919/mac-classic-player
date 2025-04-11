module.exports = {
  extends: ["@commitlint/config-conventional", "@uphold/commitlint-config"],
  rules: {
    "subject-case": [2, "always", "lower-case"],
    "type-empty": [2, "never"],
  },
};
