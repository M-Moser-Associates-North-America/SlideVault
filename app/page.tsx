import { redirect } from 'next/navigation';
import { UI_BASE } from './slide-vault/shell-config';

export default function Home() {
  redirect(UI_BASE);
}
