import { useEffect, useState } from 'react'
import App from './App'
import Grid45App from './grid45/ui/Grid45App'

type DemoId = 'grid45' | 'line'

type DemoShellProps = {
  initialDemo?: DemoId
}

const demoLabels: Record<DemoId, string> = {
  grid45: 'Cell Grid Demo',
  line: 'Line Maze Demo',
}

function readDemoFromHash(): DemoId | null {
  if (typeof window === 'undefined') return null
  if (window.location.hash === '#line') return 'line'
  if (window.location.hash === '#grid45') return 'grid45'
  return null
}

export default function DemoShell({ initialDemo = 'grid45' }: DemoShellProps) {
  const [demo, setDemo] = useState<DemoId>(() => readDemoFromHash() ?? initialDemo)

  useEffect(() => {
    const onHashChange = () => {
      setDemo(readDemoFromHash() ?? initialDemo)
    }

    window.addEventListener('hashchange', onHashChange)
    return () => {
      window.removeEventListener('hashchange', onHashChange)
    }
  }, [initialDemo])

  useEffect(() => {
    if (demo === 'line') {
      if (window.location.hash !== '#line') window.history.replaceState(null, '', '#line')
      return
    }

    if (window.location.hash === '#line') {
      const nextUrl = `${window.location.pathname}${window.location.search}`
      window.history.replaceState(null, '', nextUrl)
    }
  }, [demo])

  return (
    <div className="demoShell">
      <div className="demoViewport">{demo === 'grid45' ? <Grid45App /> : <App />}</div>
      <nav className="demoMenu" aria-label="Demo selector">
        <div className="demoMenuLabel">Demos</div>
        <div className="demoMenuTabs">
          <button
            className={`demoTab${demo === 'grid45' ? ' demoTabActive' : ''}`}
            onClick={() => setDemo('grid45')}
            type="button"
          >
            {demoLabels.grid45}
          </button>
          <button
            className={`demoTab${demo === 'line' ? ' demoTabActive' : ''}`}
            onClick={() => setDemo('line')}
            type="button"
          >
            {demoLabels.line}
          </button>
        </div>
      </nav>
    </div>
  )
}
