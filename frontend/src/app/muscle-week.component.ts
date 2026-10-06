import { Component, ChangeDetectionStrategy, computed, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SavedExerciseOption } from './exercise-catalog';
import { BACK_REGIONS, FRONT_REGIONS } from './muscle-body';
import { calendarDay, mondayFor, MUSCLES, MuscleId, MuscleVolume, shiftDay, VolumeStatus, VolumeWorkout, weeklyVolume } from './muscle-volume';

@Component({
  selector: 'app-muscle-week',
  imports: [CommonModule],
  templateUrl: './muscle-week.component.html',
  styleUrl: './muscle-week.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MuscleWeekComponent {
  readonly workouts = input<VolumeWorkout[]>([]);
  readonly activeWorkout = input<VolumeWorkout | null>(null);
  readonly exerciseOptions = input<SavedExerciseOption[]>([]);
  readonly now = input(Date.now());
  readonly assigning = input(false);
  readonly assignMuscle = output<SavedExerciseOption>();
  readonly muscles = MUSCLES;
  readonly chosenWeek = signal<string | null>(null);
  readonly selected = signal<MuscleId | 'unassigned' | null>(null);
  readonly view = signal<'front' | 'back'>('front');
  readonly currentWeek = computed(() => mondayFor(calendarDay(this.now())!));
  readonly weekStart = computed(() => this.chosenWeek() ?? this.currentWeek());
  readonly weekEnd = computed(() => shiftDay(this.weekStart(), 6));
  readonly isCurrentWeek = computed(() => this.weekStart() === this.currentWeek());
  readonly groups = computed(() => weeklyVolume(this.workouts(), this.activeWorkout(), this.weekStart(), this.exerciseOptions()));
  readonly overview = computed(() => this.groups().filter((group) => group.id !== 'unassigned' || group.count > 0));
  readonly selectedGroup = computed(() => this.groups().find((group) => group.id === this.selected()) ?? null);
  readonly regions = computed(() => this.view() === 'front' ? FRONT_REGIONS : BACK_REGIONS);
  readonly totalSets = computed(() => this.groups().reduce((count, group) => count + group.count, 0));
  readonly inRange = computed(() => this.groups().filter((group) => group.id !== 'unassigned' && group.status === 'good').length);
  readonly unassigned = computed(() => this.groups().find((group) => group.id === 'unassigned')!.count);
  readonly weekLabel = computed(() => {
    const start = new Date(`${this.weekStart()}T12:00:00Z`);
    const end = new Date(`${this.weekEnd()}T12:00:00Z`);
    const format = (date: Date) => date.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
    return `${format(start)} – ${format(end)}, ${end.getUTCFullYear()}`;
  });

  moveWeek(direction: -1 | 1): void {
    const next = shiftDay(this.weekStart(), direction * 7);
    if (next > this.currentWeek()) return;
    this.chosenWeek.set(next === this.currentWeek() ? null : next);
  }

  thisWeek(): void { this.chosenWeek.set(null); }
  groupFor(id: MuscleId): MuscleVolume { return this.groups().find((group) => group.id === id)!; }
  statusLabel(status: VolumeStatus): string { return status === 'good' ? 'In range' : status === 'below' ? 'Below target' : 'Above target'; }
  sessionDate(value: string): string { return `${calendarDay(value)}T12:00:00Z`; }
  targetMessage(group: MuscleVolume): string {
    if (group.id === 'unassigned') return 'Choose a muscle group for these exercises to include them on the body.';
    if (group.count < 4) return `${4 - group.count} more ${4 - group.count === 1 ? 'set' : 'sets'} to reach your range`;
    if (group.count <= 12) return 'Within your 4–12 set weekly range';
    return `${group.count - 12} ${group.count - 12 === 1 ? 'set' : 'sets'} above your weekly range`;
  }

  assign(name: string, event: Event): void {
    const muscle = this.muscles.find((item) => item.id === (event.target as HTMLSelectElement).value);
    if (muscle) this.assignMuscle.emit({ name, muscle_group: muscle.family });
  }
}
