from django.core.management.base import BaseCommand, CommandError

from core.project_copy import export_project_to_file, import_project_from_file


class Command(BaseCommand):
    help = 'Export one project from the database to JSON, or import it elsewhere.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--export',
            metavar='PROJECT_NAME',
            help='Export the named project to --output.',
        )
        parser.add_argument(
            '--import',
            dest='import_file',
            metavar='FILE',
            help='Import a project JSON file created by --export.',
        )
        parser.add_argument(
            '--output',
            default='project_export.json',
            help='Output path for --export (default: project_export.json).',
        )
        parser.add_argument(
            '--replace',
            action='store_true',
            help='On import, delete an existing local project with the same name first.',
        )
        parser.add_argument(
            '--rename',
            help='On import, save under this project name instead of the exported name.',
        )

    def handle(self, *args, **options):
        export_name = options.get('export')
        import_file = options.get('import_file')

        if bool(export_name) == bool(import_file):
            raise CommandError('Use exactly one of --export PROJECT_NAME or --import FILE.')

        try:
            if export_name:
                payload = export_project_to_file(export_name, options['output'])
                counts = {
                    'storeys': len(payload.get('storeys', [])),
                    'walls': len(payload.get('walls', [])),
                    'rooms': len(payload.get('rooms', [])),
                    'doors': len(payload.get('doors', [])),
                    'intersections': len(payload.get('intersections', [])),
                }
                self.stdout.write(self.style.SUCCESS(
                    f'Exported {export_name!r} -> {options["output"]} '
                    f'(walls={counts["walls"]}, rooms={counts["rooms"]}, doors={counts["doors"]})'
                ))
                return

            project = import_project_from_file(
                import_file,
                replace=options['replace'],
                rename=options['rename'],
            )
            self.stdout.write(self.style.SUCCESS(
                f'Imported project {project.name!r} (id={project.pk}).'
            ))
        except ValueError as exc:
            raise CommandError(str(exc)) from exc
