# Contributing to LaunchSim

Thank you for your interest in contributing to LaunchSim! This document provides guidelines and information for contributors.

## 🚀 Getting Started

### Prerequisites
- Node.js 18 or higher
- npm or yarn
- A modern web browser (Chrome, Firefox, Safari, Edge)

### Setup

```bash
# Fork and clone the repository
git clone https://github.com/YOUR_USERNAME/launchsim.git
cd launchsim

# Install dependencies
npm install

# Start development server
npm run dev

# Run tests
npm test
```

## 📝 How to Contribute

### Reporting Bugs

1. **Search existing issues** to avoid duplicates
2. **Use the bug report template** when creating a new issue
3. Include:
   - Browser and version
   - Steps to reproduce
   - Expected vs actual behavior
   - Screenshots if applicable
   - Console errors if any

### Suggesting Features

1. **Search existing issues** for similar suggestions
2. **Use the feature request template**
3. Describe the use case and why it would benefit users

### Submitting Code

1. **Fork the repository**
2. **Create a feature branch**: `git checkout -b feature/your-feature-name`
3. **Make your changes**
4. **Run tests**: `npm test`
5. **Commit with clear messages**: `git commit -m "Add: description of feature"`
6. **Push to your fork**: `git push origin feature/your-feature-name`
7. **Open a Pull Request**

## 💻 Code Guidelines

### JavaScript Style

- Use ES6+ features (arrow functions, destructuring, template literals)
- Use `const` by default, `let` when reassignment is needed
- Avoid `var`
- Use meaningful variable and function names
- Add JSDoc comments for public functions

```javascript
/**
 * Calculate stability margin in calibers
 * @param {number} cp - Center of pressure from nose (mm)
 * @param {number} cg - Center of gravity from nose (mm)
 * @param {number} diameter - Reference diameter (mm)
 * @returns {number} Stability margin in calibers
 */
function calculateStabilityMargin(cp, cg, diameter) {
  return (cp - cg) / diameter;
}
```

### File Organization

- Keep files focused on a single responsibility
- Group related functionality in modules
- Use descriptive file names

### CSS Guidelines

- Use CSS custom properties for theming
- Follow the existing naming conventions
- Keep specificity low
- Mobile-first responsive design

### Testing

- Write tests for new features
- Ensure existing tests pass
- Test edge cases
- Include both unit and integration tests where appropriate

## 🏗️ Project Structure

```
src/
├── physics/        # Core simulation engine
├── analysis/       # Stability, flutter, optimization
├── visualization/  # 3D viewer and charts
├── recovery/       # Dual deploy, drift prediction
├── launchday/      # Weather, checklists
├── integration/    # External device support
├── import/         # File format importers
├── api/            # External API clients
├── database/       # Component database
├── staging/        # Multi-stage rockets
├── logging/        # Flight log
└── frontend/       # Main UI application
```

## 🎯 Priority Areas

We especially welcome contributions in these areas:

### High Priority
- **Bug fixes** — Always welcome
- **Documentation** — Improvements to README, code comments, tutorials
- **Accessibility** — Screen reader support, keyboard navigation
- **Performance** — Optimization of physics engine and 3D rendering

### Medium Priority
- **Altimeter formats** — Support for additional altimeter brands
- **Component database** — Adding more real-world components
- **Internationalization** — Translations for non-English users

### Lower Priority
- **New features** — Discuss in an issue first before implementing

## 🔬 Physics Engine

When contributing to the physics engine:

- Validate against known rocket flight data
- Document assumptions and simplifications
- Include unit tests with expected values
- Reference source material for equations

## 🧪 Testing

### Running Tests

```bash
# All tests
npm test

# Physics validation only
npm run physics-test

# Watch mode
npm test -- --watch
```

### Writing Tests

```javascript
import { describe, test, expect } from 'vitest';

describe('StabilityAnalysis', () => {
  test('calculates correct CP for ogive nose', () => {
    const result = calculateNoseCP('ogive', 100, 41);
    expect(result).toBeCloseTo(46.6, 1);
  });
});
```

## 📋 Pull Request Checklist

Before submitting a PR, ensure:

- [ ] Code follows the style guidelines
- [ ] Tests pass locally (`npm test`)
- [ ] New features include tests
- [ ] Documentation is updated if needed
- [ ] Commit messages are clear and descriptive
- [ ] PR description explains the changes

## 🏷️ Commit Message Format

```
Type: Brief description

Longer explanation if needed.

Fixes #123
```

Types:
- `Add:` New feature
- `Fix:` Bug fix
- `Update:` Changes to existing functionality
- `Refactor:` Code restructuring without behavior change
- `Docs:` Documentation only
- `Test:` Adding or updating tests
- `Style:` Formatting, no code change

## 📜 License

By contributing, you agree that your contributions will be licensed under the MIT License.

## 🙋 Questions?

- Open an issue for general questions
- Tag maintainers if you need guidance on a specific area

Thank you for helping make LaunchSim better! 🚀
