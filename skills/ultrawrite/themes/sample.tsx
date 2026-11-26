import { useState, type JSX, type ReactNode } from 'react';
import { Button } from '@ui-sdk/react/button';
import { Field, FieldDescription, FieldError, FieldLabel } from '@ui-sdk/react/field';
import { Label } from '@ui-sdk/react/label';
import { Input } from '@ui-sdk/react/input';
import { Textarea } from '@ui-sdk/react/textarea';
import {
  NumberInput,
  NumberInputControl,
  NumberInputDecrement,
  NumberInputGroup,
  NumberInputIncrement,
} from '@ui-sdk/react/number-input';
import { Select, SelectContent, SelectItem, SelectItemIndicator, SelectTrigger, SelectValue } from '@ui-sdk/react/select';
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@ui-sdk/react/dialog';
import {
  AlertDialog,
  AlertDialogBackdrop,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@ui-sdk/react/alert-dialog';
import { Checkbox, CheckboxIndicator } from '@ui-sdk/react/checkbox';
import { Switch, SwitchThumb } from '@ui-sdk/react/switch';
import { SegmentedControl, SegmentedControlIndicator, SegmentedControlItem } from '@ui-sdk/react/segmented-control';
import { Radio, RadioGroup, RadioIndicator } from '@ui-sdk/react/radio';
import { Tabs, TabsIndicator, TabsList, TabsPanel, TabsTab } from '@ui-sdk/react/tabs';
import {
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuItemIndicator,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from '@ui-sdk/react/menu';
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from '@ui-sdk/react/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@ui-sdk/react/tooltip';
import {
  Toast,
  ToastAction,
  ToastClose,
  ToastDescription,
  ToastRegion,
  ToastTitle,
  createToaster,
} from '@ui-sdk/react/toast';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxLabel,
  ComboboxList,
  ComboboxTrigger,
} from '@ui-sdk/react/combobox';
import { Meter, MeterIndicator, MeterLabel, MeterTrack, MeterValue } from '@ui-sdk/react/meter';
import { Progress, ProgressIndicator, ProgressLabel, ProgressTrack, ProgressValue } from '@ui-sdk/react/progress';
import { Separator } from '@ui-sdk/react/separator';
import contract from './contract.json';

const roles = [
  { value: 'viewer', label: 'Viewer' },
  { value: 'editor', label: 'Editor' },
  { value: 'owner', label: 'Owner' },
];

const fruits = ['Apple', 'Banana', 'Cherry', 'Damson'];

function RoleSelect(props: { defaultValue?: string; disabled?: boolean; readOnly?: boolean }) {
  return (
    <Select placeholder="Pick a role" {...props}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {roles.map((r) => (
          <SelectItem key={r.value} value={r.value} disabled={r.value === 'owner'}>
            {r.label}
            <SelectItemIndicator />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function FruitCombobox(props: { label: string; disabled?: boolean; readOnly?: boolean; defaultValue?: string }) {
  return (
    <Combobox {...props}>
      <ComboboxLabel>{props.label}</ComboboxLabel>
      <ComboboxInput placeholder="Search fruit" />
      <ComboboxTrigger aria-label={`Show ${props.label}`} />
      <ComboboxContent>
        <ComboboxEmpty>No fruit matches.</ComboboxEmpty>
        <ComboboxList>
          {fruits.map((f) => (
            <ComboboxItem key={f} value={f.toLowerCase()} label={f} disabled={f === 'Damson'}>
              {f}
              <ComboboxItemIndicator />
            </ComboboxItem>
          ))}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

function Seats(props: { label: string; defaultValue: number; disabled?: boolean; readOnly?: boolean; invalid?: boolean }) {
  const { label, invalid, ...rest } = props;
  return (
    <Field name={label} invalid={invalid}>
      <FieldLabel>{label}</FieldLabel>
      <NumberInput min={1} max={10} {...rest}>
        <NumberInputGroup>
          <NumberInputDecrement aria-label="Fewer" />
          <NumberInputControl />
          <NumberInputIncrement aria-label="More" />
        </NumberInputGroup>
      </NumberInput>
    </Field>
  );
}

function ToastDemo() {
  const [toaster] = useState(() => createToaster());
  return (
    <>
      <Button
        onClick={() =>
          toaster('Event created', {
            description: 'Friday at 10:00 AM',
            action: { label: 'Undo', onAction: () => {} },
          })
        }
      >
        Show a toast
      </Button>
      <ToastRegion toaster={toaster}>
        {() => (
          <Toast>
            <ToastTitle />
            <ToastDescription />
            <ToastAction />
            <ToastClose aria-label="Dismiss" />
          </Toast>
        )}
      </ToastRegion>
    </>
  );
}

const sections: Record<string, () => ReactNode> = {
  Button: () => (
    <>
      <Button>Save changes</Button>
      <Button disabled>Disabled</Button>
      <Button onClick={() => new Promise((r) => setTimeout(r, 2000))}>Pending on press</Button>
    </>
  ),
  Field: () => (
    <>
      <Field name="name">
        <FieldLabel>Project name</FieldLabel>
        <Input placeholder="Apollo" />
        <FieldDescription>Shown on the board.</FieldDescription>
      </Field>
      <Field name="email" invalid>
        <FieldLabel>Email</FieldLabel>
        <Input defaultValue="not-an-email" />
        <FieldDescription>Where invites go.</FieldDescription>
        <FieldError>Use an address with an @ in it.</FieldError>
      </Field>
      <Field name="locked" disabled>
        <FieldLabel>Workspace id</FieldLabel>
        <Input defaultValue="ws_1420" />
        <FieldDescription>Set when the workspace was made.</FieldDescription>
      </Field>
      <Label>
        <Checkbox disabled>
          <CheckboxIndicator />
        </Checkbox>
        A disabled control in a label
      </Label>
    </>
  ),
  Input: () => (
    <>
      <Input aria-label="Empty" placeholder="Placeholder" />
      <Input aria-label="Filled" defaultValue="Filled" />
      <Field name="input-invalid" invalid>
        <FieldLabel>Invalid</FieldLabel>
        <Input defaultValue="Invalid" />
      </Field>
      <Input aria-label="Disabled" disabled defaultValue="Disabled" />
      <Input aria-label="Read only" readOnly defaultValue="Read only" />
    </>
  ),
  Textarea: () => (
    <>
      <Textarea aria-label="Empty" placeholder="Placeholder" />
      <Textarea aria-label="Filled" defaultValue="Filled" />
      <Field name="textarea-invalid" invalid>
        <FieldLabel>Invalid</FieldLabel>
        <Textarea defaultValue="Invalid" />
      </Field>
      <Textarea aria-label="Disabled" disabled defaultValue="Disabled" />
      <Textarea aria-label="Read only" readOnly defaultValue="Read only" />
    </>
  ),
  'Number Input': () => (
    <>
      <Seats label="Seats" defaultValue={3} />
      <Seats label="At the lower bound" defaultValue={1} />
      <Seats label="Invalid seats" defaultValue={3} invalid />
      <Seats label="Disabled seats" defaultValue={3} disabled />
      <Seats label="Read-only seats" defaultValue={3} readOnly />
    </>
  ),
  Select: () => (
    <>
      <Field name="role">
        <FieldLabel>Role</FieldLabel>
        <RoleSelect />
      </Field>
      <Field name="role-chosen">
        <FieldLabel>Role (chosen)</FieldLabel>
        <RoleSelect defaultValue="editor" />
      </Field>
      <Field name="role-invalid" invalid>
        <FieldLabel>Role (invalid)</FieldLabel>
        <RoleSelect />
      </Field>
      <Field name="role-disabled" disabled>
        <FieldLabel>Role (disabled)</FieldLabel>
        <RoleSelect disabled defaultValue="viewer" />
      </Field>
      <Field name="role-readonly">
        <FieldLabel>Role (read only)</FieldLabel>
        <RoleSelect readOnly defaultValue="viewer" />
      </Field>
    </>
  ),
  Dialog: () => (
    <>
      <Dialog>
        <DialogTrigger>Open dialog</DialogTrigger>
        <DialogBackdrop />
        <DialogContent>
          <DialogTitle>Project details</DialogTitle>
          <DialogDescription>Review the details before you continue.</DialogDescription>
          <Field name="dialog-name">
            <FieldLabel>Name</FieldLabel>
            <Input defaultValue="Apollo" />
          </Field>
          <DialogClose>Close</DialogClose>
          <DialogClose disabled>Disabled close</DialogClose>
        </DialogContent>
      </Dialog>
      <Dialog>
        <DialogTrigger disabled>Disabled trigger</DialogTrigger>
        <DialogContent>
          <DialogTitle>Never opens</DialogTitle>
        </DialogContent>
      </Dialog>
    </>
  ),
  'Alert Dialog': () => (
    <>
      <AlertDialog>
        <AlertDialogTrigger>Delete project</AlertDialogTrigger>
        <AlertDialogBackdrop />
        <AlertDialogContent>
          <AlertDialogTitle>Delete Apollo?</AlertDialogTitle>
          <AlertDialogDescription>The project is deleted for everyone.</AlertDialogDescription>
          <AlertDialogClose>Keep it</AlertDialogClose>
          <AlertDialogClose value="confirm">Delete Apollo</AlertDialogClose>
          <AlertDialogClose disabled>Disabled close</AlertDialogClose>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog>
        <AlertDialogTrigger disabled>Disabled trigger</AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogTitle>Never opens</AlertDialogTitle>
        </AlertDialogContent>
      </AlertDialog>
    </>
  ),
  Checkbox: () => (
    <>
      {[
        { text: 'Checked', props: { defaultChecked: true } },
        { text: 'Unchecked', props: {} },
        { text: 'Mixed', props: { defaultChecked: 'indeterminate' as const } },
        { text: 'Disabled', props: { disabled: true, defaultChecked: true } },
        { text: 'Read only', props: { readOnly: true, defaultChecked: true } },
      ].map(({ text, props }) => (
        <Label key={text}>
          <Checkbox {...props}>
            <CheckboxIndicator />
          </Checkbox>
          {text}
        </Label>
      ))}
      <Field name="checkbox-invalid" invalid>
        <Checkbox>
          <CheckboxIndicator />
        </Checkbox>
        <FieldLabel>Invalid</FieldLabel>
      </Field>
    </>
  ),
  Switch: () => (
    <>
      {[
        { text: 'On', props: { defaultChecked: true } },
        { text: 'Off', props: {} },
        { text: 'Disabled', props: { disabled: true } },
        { text: 'Read only', props: { readOnly: true, defaultChecked: true } },
      ].map(({ text, props }) => (
        <Label key={text}>
          <Switch {...props}>
            <SwitchThumb />
          </Switch>
          {text}
        </Label>
      ))}
      <Field name="switch-invalid" invalid>
        <FieldLabel>Invalid</FieldLabel>
        <Switch>
          <SwitchThumb />
        </Switch>
      </Field>
    </>
  ),
  'Segmented Control': () => (
    <>
      {[
        { label: 'View', props: {} },
        { label: 'Disabled view', props: { disabled: true } },
        { label: 'Read-only view', props: { readOnly: true } },
      ].map(({ label, props }) => (
        <SegmentedControl key={label} aria-label={label} defaultValue="list" {...props}>
          <SegmentedControlIndicator />
          <SegmentedControlItem value="list">List</SegmentedControlItem>
          <SegmentedControlItem value="grid">Grid</SegmentedControlItem>
          <SegmentedControlItem value="board" disabled>
            Board
          </SegmentedControlItem>
        </SegmentedControl>
      ))}
    </>
  ),
  Radio: () => (
    <>
      {[
        { label: 'Shipping', props: {} },
        { label: 'Disabled shipping', props: { disabled: true } },
        { label: 'Read-only shipping', props: { readOnly: true } },
      ].map(({ label, props }) => (
        <Field key={label} name={label}>
          <FieldLabel>{label}</FieldLabel>
          <RadioGroup defaultValue="standard" {...props}>
            {['Standard', 'Express', 'Overnight'].map((s) => (
              <Label key={s}>
                <Radio value={s.toLowerCase()} disabled={s === 'Overnight'}>
                  <RadioIndicator />
                </Radio>
                {s}
              </Label>
            ))}
          </RadioGroup>
        </Field>
      ))}
    </>
  ),
  Tabs: () => (
    <Tabs defaultValue="account">
      <TabsList aria-label="Settings">
        <TabsIndicator />
        <TabsTab value="account">Account</TabsTab>
        <TabsTab value="password">Password</TabsTab>
        <TabsTab value="billing" disabled>
          Billing
        </TabsTab>
      </TabsList>
      <TabsPanel value="account">Manage your profile.</TabsPanel>
      <TabsPanel value="password">Choose a new password.</TabsPanel>
      <TabsPanel value="billing">Not yet.</TabsPanel>
    </Tabs>
  ),
  Menu: () => (
    <Menu>
      <MenuTrigger>Actions</MenuTrigger>
      <MenuContent>
        <MenuItem value="rename">Rename</MenuItem>
        <MenuItem value="duplicate">Duplicate</MenuItem>
        <MenuItem value="archive" disabled>
          Archive
        </MenuItem>
        <MenuSeparator />
        <MenuGroup>
          <MenuGroupLabel>Show</MenuGroupLabel>
          <MenuCheckboxItem value="status-bar" defaultChecked>
            <MenuItemIndicator keepMounted />
            Status bar
          </MenuCheckboxItem>
          <MenuCheckboxItem value="minimap">
            <MenuItemIndicator keepMounted />
            Minimap
          </MenuCheckboxItem>
        </MenuGroup>
        <MenuSeparator />
        <MenuRadioGroup defaultValue="comfortable">
          <MenuGroupLabel>Density</MenuGroupLabel>
          {['Compact', 'Comfortable'].map((o) => (
            <MenuRadioItem key={o} value={o.toLowerCase()}>
              <MenuItemIndicator />
              {o}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  ),
  Popover: () => (
    <Popover>
      <PopoverTrigger>Share</PopoverTrigger>
      <PopoverContent>
        <PopoverTitle>Share this document</PopoverTitle>
        <PopoverDescription>Anyone with the link can view it.</PopoverDescription>
        <PopoverClose>Done</PopoverClose>
        <PopoverClose disabled>Disabled close</PopoverClose>
      </PopoverContent>
    </Popover>
  ),
  Tooltip: () => (
    <Tooltip>
      <TooltipTrigger>Hover or focus me</TooltipTrigger>
      <TooltipContent>Anyone with the link can view</TooltipContent>
    </Tooltip>
  ),
  Toast: () => <ToastDemo />,
  Combobox: () => (
    <>
      <FruitCombobox label="Fruit" />
      <Field name="fruit-invalid" invalid>
        <FruitCombobox label="Invalid fruit" />
      </Field>
      <FruitCombobox label="Disabled fruit" disabled />
      <FruitCombobox label="Read-only fruit" readOnly defaultValue="apple" />
    </>
  ),
  Meter: () => (
    <Meter value={68}>
      <MeterLabel>Storage used</MeterLabel>
      <MeterValue />
      <MeterTrack>
        <MeterIndicator />
      </MeterTrack>
    </Meter>
  ),
  Progress: () => (
    <>
      {[
        { text: 'Exporting video', value: 60 },
        { text: 'Waiting for the server', value: null },
        { text: 'Export done', value: 100 },
      ].map(({ text, value }) => (
        <Progress key={text} value={value}>
          <ProgressLabel>{text}</ProgressLabel>
          <ProgressValue />
          <ProgressTrack>
            <ProgressIndicator />
          </ProgressTrack>
        </Progress>
      ))}
    </>
  ),
  Separator: () => (
    <>
      <Separator />
      <div style={{ display: 'flex', height: '2rem' }}>
        <span>Left</span>
        <Separator orientation="vertical" />
        <span>Right</span>
      </div>
    </>
  ),
};

export function Sample(): JSX.Element {
  return (
    <main data-theme-sample="">
      <h1>Theme sample</h1>
      {contract.components.map(({ name }) => {
        const render = sections[name];
        if (!render) throw new Error(`sample: no section for ${name}`);
        return (
          <section key={name} data-component={name}>
            <h2>{name}</h2>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-start' }}>{render()}</div>
          </section>
        );
      })}
    </main>
  );
}
