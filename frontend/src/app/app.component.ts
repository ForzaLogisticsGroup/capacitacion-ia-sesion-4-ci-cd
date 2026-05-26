import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TodoService, Todo } from './todo.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent implements OnInit {
  todos = signal<Todo[]>([]);
  newTodoTitle = '';
  loading = signal(false);
  error = signal('');

  constructor(private todoService: TodoService) {}

  ngOnInit() {
    this.loadTodos();
  }

  loadTodos() {
    this.loading.set(true);
    this.todoService.getAll().subscribe({
      next: (todos) => {
        this.todos.set(todos);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Error al cargar las tareas. Asegurate de que el backend este corriendo en http://localhost:5000');
        this.loading.set(false);
      }
    });
  }

  addTodo() {
    if (!this.newTodoTitle.trim()) return;
    this.todoService.create({ title: this.newTodoTitle.trim(), isCompleted: false }).subscribe({
      next: (created) => {
        this.todos.update(todos => [...todos, created]);
        this.newTodoTitle = '';
      },
      error: () => this.error.set('Error al crear la tarea.')
    });
  }

  toggleTodo(todo: Todo) {
    const updated = { ...todo, isCompleted: !todo.isCompleted };
    this.todoService.update(todo.id, updated).subscribe({
      next: () => this.todos.update(todos => todos.map(t => t.id === todo.id ? updated : t)),
      error: () => this.error.set('Error al actualizar la tarea.')
    });
  }

  deleteTodo(id: number) {
    this.todoService.delete(id).subscribe({
      next: () => this.todos.update(todos => todos.filter(t => t.id !== id)),
      error: () => this.error.set('Error al eliminar la tarea.')
    });
  }

  clearError() {
    this.error.set('');
  }
}
