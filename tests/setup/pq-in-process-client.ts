import { AppError } from "@/crypto/errors"
import {
  clientFromRpc,
  validatePqWorkerRequest,
  validateWorkerResult,
  type PqCryptoClient,
  type RpcCall,
} from "@/crypto/pq/worker-client"
import { handlePqWorkerRequest } from "@/workers/pq-crypto.worker"

// Node-test replacement for the browser Worker: same validation on both sides of
// the call, no structured clone - request objects are shared by reference, and
// after the wipe task their sensitive request buffers come back zeroed.
export function createInProcessPqClient(): PqCryptoClient {
  let disposed = false
  let nextId = 0
  const call: RpcCall = async (operation, payload) => {
    if (disposed) throw new AppError("WORKER_UNAVAILABLE")
    validatePqWorkerRequest(operation, payload)
    const id = `node-${nextId++}`
    const response = await handlePqWorkerRequest({ id, operation, payload })
    if (disposed) throw new AppError("WORKER_UNAVAILABLE")
    if (!response.ok) throw new AppError(response.code)
    return validateWorkerResult(operation, payload, response.value)
  }
  return clientFromRpc(call, () => {
    disposed = true
  })
}
