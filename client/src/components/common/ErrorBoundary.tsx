import { Component, type ErrorInfo, type ReactNode } from 'react'
import Icon from './Icon'
import styles from './ErrorBoundary.module.css'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
  }

  public static getDerivedStateFromError(_: Error): State {
    return { hasError: true }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo)
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className={styles.screen}>
          <Icon name="exclamation-triangle" className={styles.icon} />
          <h1 className={styles.title}>Something went wrong</h1>
          <p className={styles.text}>The application encountered an unexpected error.</p>
          <button
            onClick={() => {
              this.setState({ hasError: false })
              window.location.href = '/'
            }}
            className={styles.button}
          >
            <Icon name="home" />
            Go back Home
          </button>
        </div>
      )
    }

    return this.props.children
  }
}

export default ErrorBoundary
