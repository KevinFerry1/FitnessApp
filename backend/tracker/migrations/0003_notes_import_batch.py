from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("tracker", "0002_offline_profile")]

    operations = [
        migrations.CreateModel(
            name="NotesImportBatch",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("client_id", models.UUIDField(unique=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("workout_ids", models.JSONField(default=list)),
            ],
        ),
    ]
