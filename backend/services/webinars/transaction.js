function aggregateRollbackFailure(primaryError, rollbackError, destroyError = null) {
  const errors = destroyError
    ? [primaryError, rollbackError, destroyError]
    : [primaryError, rollbackError];
  const aggregate = new AggregateError(
    errors,
    'Transaction failed and rollback failed',
    { cause: primaryError },
  );
  aggregate.primaryError = primaryError;
  aggregate.rollbackError = rollbackError;
  if (destroyError) aggregate.destroyError = destroyError;
  return aggregate;
}

async function runTransaction(connectionPool, work) {
  const connection = await connectionPool.getConnection();
  let discard = false;
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (primaryError) {
    try {
      await connection.rollback();
    } catch (rollbackError) {
      discard = true;
      let destroyError = null;
      try {
        if (typeof connection.destroy === 'function') await connection.destroy();
      } catch (error) {
        destroyError = error;
      }
      throw aggregateRollbackFailure(primaryError, rollbackError, destroyError);
    }
    throw primaryError;
  } finally {
    if (!discard) connection.release();
  }
}

module.exports = { aggregateRollbackFailure, runTransaction };
