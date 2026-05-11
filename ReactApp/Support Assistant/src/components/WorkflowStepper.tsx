import type { SEQUENCE_STEPS } from '../constants'

type WorkflowStepperProps = {
  steps: typeof SEQUENCE_STEPS
  activeIndex: number
}

export default function WorkflowStepper({ steps, activeIndex }: WorkflowStepperProps) {
  return (
    <div className="stepper">
      {steps.flatMap((step, i) => {
        const isDone = i < activeIndex
        const isActive = i === activeIndex
        const result: React.ReactNode[] = []

        if (i > 0) {
          result.push(
            <div
              key={`conn-${i}`}
              className={`stepper-connector${i <= activeIndex ? ' passed' : ''}`}
            />,
          )
        }

        result.push(
          <div
            key={step}
            className={`stepper-step${isDone ? ' done' : isActive ? ' active' : ' pending'}`}
          >
            <div className="stepper-node">{isDone ? '✓' : i + 1}</div>
            <span className="stepper-label">{step}</span>
          </div>,
        )

        return result
      })}
    </div>
  )
}
