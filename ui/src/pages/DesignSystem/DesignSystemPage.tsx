import React from 'react';
import { useTheme } from '../../themes/useTheme';
import {
  Button,
  IconButton,
  Card,
  Badge,
  StatusBadge,
  Input,
  Textarea,
  Select,
  Checkbox,
  Switch,
  Alert,
  Spinner,
  Skeleton,
  EmptyState,
  ErrorState,
  Breadcrumb,
  Tabs,
  Pagination,
  Table,
  Dialog,
  Drawer,
  Dropdown,
  Popover,
  Tooltip,
} from '../../components/ui';

import '../../components/ui/ui.css';

function ThemeControls() {
  const theme = useTheme();
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <div>Theme: {theme.theme} (resolved: {theme.resolvedTheme})</div>
      <Button variant="secondary" onClick={() => theme.setTheme('light')}>Light</Button>
      <Button variant="secondary" onClick={() => theme.setTheme('dark')}>Dark</Button>
      <Button variant="secondary" onClick={() => theme.setTheme('system')}>System</Button>
    </div>
  );
}

export default function DesignSystemPage() {
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  const tabs = [
    { id: 't1', label: 'Tab 1', panel: <div>Panel 1</div> },
    { id: 't2', label: 'Tab 2', panel: <div>Panel 2</div> },
  ];

  const table = (
    <Table caption={<strong>Example table</strong>} empty={<div>Empty</div>}>
      <thead>
        <tr><th>Col A</th><th>Col B</th></tr>
      </thead>
      <tbody>
        <tr><td>Value A1</td><td>Value B1</td></tr>
        <tr><td>Value A2</td><td>Value B2</td></tr>
      </tbody>
    </Table>
  );

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      <h1>Design System Showcase</h1>
      <section aria-labelledby="tokens">
          <h2 id="tokens">Design tokens</h2>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ padding: 12, background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              Surface
            </div>
            <div style={{ padding: 12, background: 'var(--color-primary)', color: 'white' }}>Primary</div>
            <div style={{ padding: 12, background: 'var(--color-danger)', color: 'white' }}>Danger</div>
          </div>
        </section>

        <section aria-labelledby="theme">
          <h2 id="theme">Theme</h2>
          <ThemeControls />
        </section>

        <section aria-labelledby="buttons">
          <h2 id="buttons">Buttons</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="primary">Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
            <Button loading>Loading</Button>
            <Button disabled>Disabled</Button>
            <IconButton label="Settings">⚙️</IconButton>
          </div>
        </section>

        <section aria-labelledby="cards">
          <h2 id="cards">Cards</h2>
          <Card title="Card title" description="Card description">Card content</Card>
        </section>

        <section aria-labelledby="badges">
          <h2 id="badges">Badges</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <Badge variant="neutral">Neutral</Badge>
            <Badge variant="primary">Primary</Badge>
            <Badge variant="success">Success</Badge>
          </div>
        </section>

        <section aria-labelledby="status">
          <h2 id="status">StatusBadge</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <StatusBadge status="running" />
            <StatusBadge status="offline" />
            <StatusBadge status="completed" />
          </div>
        </section>

        <section aria-labelledby="forms">
          <h2 id="forms">Form controls</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Input label="Name" placeholder="Enter name" />
            <Input label="Email" error="Invalid" />
            <Textarea label="Notes" placeholder="Enter notes" />
            <Select label="Choice"><option>One</option><option>Two</option></Select>
            <Checkbox label="Accept" />
            <Switch label="Enabled" />
          </div>
        </section>

        <section aria-labelledby="feedback">
          <h2 id="feedback">Feedback</h2>
          <Alert title="Info">This is an info alert</Alert>
          <Spinner />
          <Skeleton variant="rect" width={200} height={20} />
          <EmptyState title="No items" description="There are no items to show" />
          <ErrorState title="Error" description="Something went wrong" onRetry={() => {}} />
        </section>

        <section aria-labelledby="nav">
          <h2 id="nav">Navigation</h2>
          <Breadcrumb items={[{ label: 'Home', href: '/' }, { label: 'Design System', current: true }]} />
          <Tabs items={tabs} />
          <Pagination current={1} total={5} onChange={() => {}} />
        </section>

        <section aria-labelledby="data">
          <h2 id="data">Data</h2>
          {table}
        </section>

        <section aria-labelledby="overlays">
          <h2 id="overlays">Overlays</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button onClick={() => setDialogOpen(true)}>Open Dialog</Button>
            <Button onClick={() => setDrawerOpen(true)}>Open Drawer</Button>
            <Dropdown trigger={<Button>Open Menu</Button>}>
              <div style={{ padding: 8 }}><button>Item 1</button></div>
            </Dropdown>
            <Popover trigger={<Button>Open Popover</Button>} content={<div style={{ padding: 8 }}>Popover content</div>} />
            <Tooltip content="Helpful tip"><IconButton label="Info">i</IconButton></Tooltip>
          </div>
        </section>

        <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title="Demo dialog">Dialog content</Dialog>
        <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title="Demo drawer">Drawer content</Drawer>
      </div>
  );
}
