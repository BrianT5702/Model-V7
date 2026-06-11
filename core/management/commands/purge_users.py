from django.contrib.auth.models import User
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = 'Delete all user accounts except one kept superadmin account.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--keep',
            default='admin',
            help='Username of the account to keep (default: admin).',
        )
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Show which accounts would be removed without deleting.',
        )

    def handle(self, *args, **options):
        keep_username = (options['keep'] or '').strip()
        dry_run = options['dry_run']

        if not keep_username:
            raise CommandError('Provide a username with --keep.')

        try:
            keep_user = User.objects.get(username=keep_username)
        except User.DoesNotExist as exc:
            raise CommandError(f'Keep user "{keep_username}" does not exist.') from exc

        to_delete = User.objects.exclude(pk=keep_user.pk).order_by('username')
        usernames = list(to_delete.values_list('username', flat=True))

        if not usernames:
            self.stdout.write(self.style.SUCCESS(f'Only "{keep_username}" exists. Nothing to remove.'))
            return

        if dry_run:
            self.stdout.write(self.style.WARNING('DRY RUN — no accounts will be deleted.'))
            self.stdout.write(f'Keeping: {keep_username} (id={keep_user.pk}, superuser={keep_user.is_superuser})')
            self.stdout.write('Would remove:')
            for name in usernames:
                self.stdout.write(f'  - {name}')
            return

        deleted_count, _ = to_delete.delete()
        self.stdout.write(self.style.SUCCESS(
            f'Kept "{keep_username}". Removed {len(usernames)} account(s): {", ".join(usernames)} '
            f'({deleted_count} related rows).',
        ))
