using Microsoft.AspNetCore.Mvc;
using TodoApi.Models;

namespace TodoApi.Controllers;

[ApiController]
[Route("api/[controller]")]
public class TodoController : ControllerBase
{
    private static readonly List<Todo> _todos = new()
    {
        new Todo { Id = 1, Title = "Aprender GitHub Actions", IsCompleted = false },
        new Todo { Id = 2, Title = "Configurar CI/CD", IsCompleted = false },
        new Todo { Id = 3, Title = "Desplegar la aplicación", IsCompleted = false }
    };
    private static int _nextId = 4;

    [HttpGet]
    public ActionResult<IEnumerable<Todo>> GetAll() => Ok(_todos);

    [HttpGet("{id:int}")]
    public ActionResult<Todo> GetById(int id)
    {
        var todo = _todos.FirstOrDefault(t => t.Id == id);
        return todo is null ? NotFound() : Ok(todo);
    }

    [HttpPost]
    public ActionResult<Todo> Create([FromBody] Todo todo)
    {
        todo.Id = _nextId++;
        todo.CreatedAt = DateTime.UtcNow;
        _todos.Add(todo);
        return CreatedAtAction(nameof(GetById), new { id = todo.Id }, todo);
    }

    [HttpPut("{id:int}")]
    public ActionResult Update(int id, [FromBody] Todo updated)
    {
        var todo = _todos.FirstOrDefault(t => t.Id == id);
        if (todo is null) return NotFound();
        todo.Title = updated.Title;
        todo.IsCompleted = updated.IsCompleted;
        return NoContent();
    }

    [HttpDelete("{id:int}")]
    public ActionResult Delete(int id)
    {
        var todo = _todos.FirstOrDefault(t => t.Id == id);
        if (todo is null) return NotFound();
        _todos.Remove(todo);
        return NoContent();
    }
}
