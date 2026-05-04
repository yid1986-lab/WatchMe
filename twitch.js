function log(level, scope, message, extra = null) {
  const prefix = `[watchme-v2/worker][${scope}]`;
  if (extra) {
    console.log(`${prefix}[${level}] ${message}`, extra);
    return;
  }
  console.log(`${prefix}[${level}] ${message}`);
}

module.exports = {
  log,
};
