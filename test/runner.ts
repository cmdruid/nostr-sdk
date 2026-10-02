import './cases/unit/runner.js'
import './cases/integration/runner.js'

// Force exit after tests complete to prevent hanging on unclosed resources
import tape from 'tape'

let failed = false
tape.onFailure(() => { failed = true })
tape.onFinish(() => {
  // Give a moment for any final cleanup, then force exit
  setTimeout(() => {
    process.exit(failed ? 1 : 0)
  }, 500)
})

// Safety timeout - force exit if tests hang for too long (3 minutes)
setTimeout(() => {
  console.error('\n[Error] Test suite timed out after 3 minutes')
  process.exit(1)
}, 180000).unref()
