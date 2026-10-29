import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { FeedbackProvider } from '../../src/renderer/src/feedback/FeedbackProvider'
import { Gallery } from '../../src/renderer/src/gallery/Gallery'

describe('Gallery', () => {
  test('renders every section without crashing', () => {
    render(
      <FeedbackProvider>
        <Gallery />
      </FeedbackProvider>
    )
    for (const section of [
      'Buttons',
      'Tabs',
      'Table',
      'Screen states',
      'Doctor rows',
      'Modal and wizard',
      'Text field',
      'Title bar controls'
    ]) {
      expect(screen.getByText(section)).toBeTruthy()
    }
  })
})
